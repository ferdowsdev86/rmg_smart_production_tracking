"""Continuous detect → confirm → track of a specific employee in a CCTV stream.

Single-frame face recognition is unreliable on a wide factory shot (the person
turns away, gets occluded, or is tiny). This module runs a stateful background
loop that:

  1. continuously reads the high-resolution camera stream,
  2. recognises the target face periodically (identity = source of truth),
  3. confirms the match across a few frames before locking on, and
  4. uses an object tracker (CSRT/KCF) to keep the red box on that person
     between recognitions — even while they are turned away.

Each (stream, employee) pair gets its own loop, started on demand by the
snapshot view and auto-stopped a few seconds after polling stops.
"""

from __future__ import annotations

import logging
import threading
import time

import numpy as np

from floors import face_match
from floors.camera_live import (
    _encode_frame_jpeg,
    detect_rtsp_url_candidates,
    get_configured_rtsp_url,
    normalize_live_rtsp_url,
)

logger = logging.getLogger(__name__)

# How often to (re)run face recognition (seconds). The tracker fills the gaps.
_RECOG_INTERVAL = 0.8
# Confirmations required before locking on (kills transient wrong matches).
_CONFIRM_HITS = 2
# Keep the box via the tracker for at most this long without a fresh recognition.
_MAX_TRACK_WITHOUT_RECOG = 5.0
# After the tracker loses the target, hold the last box this long ("last seen").
_PERSIST_AFTER_LOSS = 1.5
# Stop the loop if nobody has polled for this long (releases the RTSP stream).
_IDLE_STOP = 8.0
# Working resolution: full 3200x1800 frames make CSRT/recognition very slow, so
# we downscale once to this width — still detailed enough to recognise faces.
_WORK_WIDTH = 1600
# Width of the annotated JPEG sent to the browser.
_OUT_WIDTH = 1280


def _to_work_size(frame):
    import cv2  # type: ignore

    h, w = frame.shape[:2]
    if w > _WORK_WIDTH:
        nh = int(h * (_WORK_WIDTH / float(w)))
        return cv2.resize(frame, (_WORK_WIDTH, nh), interpolation=cv2.INTER_AREA)
    return frame

_LOOPS_LOCK = threading.Lock()
# track_key -> {"thread", "stop", "out": (ts, jpeg, err), "last_req", "label"}
_LOOPS: dict[str, dict] = {}


def _make_tracker():
    import cv2  # type: ignore

    for name in ("TrackerCSRT_create", "TrackerKCF_create", "TrackerMIL_create"):
        if hasattr(cv2, name):
            try:
                return getattr(cv2, name)()
            except Exception:
                continue
    return None


def trackers_available() -> bool:
    try:
        import cv2  # type: ignore
    except ImportError:
        return False
    return any(
        hasattr(cv2, n)
        for n in ("TrackerCSRT_create", "TrackerKCF_create", "TrackerMIL_create")
    )


def _init_tracker(frame, box):
    """Create + init a tracker on box=(x1,y1,x2,y2). Returns tracker or None."""
    tracker = _make_tracker()
    if tracker is None:
        return None
    x1, y1, x2, y2 = box
    w, h = max(1, x2 - x1), max(1, y2 - y1)
    try:
        tracker.init(frame, (int(x1), int(y1), int(w), int(h)))
        return tracker
    except Exception:
        logger.exception("tracker init failed")
        return None


def _set_out(track_key: str, jpeg: bytes | None, err: str | None) -> None:
    with _LOOPS_LOCK:
        info = _LOOPS.get(track_key)
        if info is not None:
            info["out"] = (time.monotonic(), jpeg, err)


def _open_capture(candidates):
    import cv2  # type: ignore

    for candidate in candidates:
        cap = cv2.VideoCapture(candidate, cv2.CAP_FFMPEG)
        if cap.isOpened():
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass
            return cap, candidate
        try:
            cap.release()
        except Exception:
            pass
    return None, None


def _loop(track_key: str, candidates, emp: str, label: str | None, stop_event: threading.Event) -> None:
    try:
        import cv2  # type: ignore  # noqa: F401
    except ImportError:
        _set_out(track_key, None, "opencv not installed")
        return

    name = (label or emp).strip()

    while not stop_event.is_set():
        cap, _used = _open_capture(candidates)
        if cap is None:
            _set_out(track_key, None, "Could not open RTSP stream")
            if stop_event.wait(2.0):
                break
            continue

        tracker = None
        lock_box = None          # last known box (x1,y1,x2,y2)
        locked = False
        last_recog = 0.0
        last_seen = 0.0          # last *recognition* success time
        pending_box = None
        pending_hits = 0

        try:
            while not stop_event.is_set():
                # Auto-stop when nobody is watching anymore.
                with _LOOPS_LOCK:
                    info = _LOOPS.get(track_key)
                    if info is None or (time.monotonic() - info["last_req"]) > _IDLE_STOP:
                        return

                # Read consecutive frames (BUFFERSIZE=1 keeps them recent) so the
                # tracker sees smooth motion; flushing many grabs would both drop
                # frames and waste CPU decoding the full-res stream.
                ok, frame = cap.read()
                if not ok or frame is None:
                    _set_out(track_key, None, "RTSP read failed")
                    break
                frame = _to_work_size(frame)

                now = time.monotonic()

                # 1) Advance the tracker (cheap, every frame).
                if tracker is not None:
                    ok, xywh = tracker.update(frame)
                    if ok:
                        x, y, w, h = (int(v) for v in xywh)
                        lock_box = (x, y, x + w, y + h)
                    else:
                        tracker = None

                # 2) Periodically re-recognise — identity is the source of truth.
                if (now - last_recog) >= _RECOG_INTERVAL:
                    last_recog = now
                    cand, _score = face_match.locate_employee(frame, emp)
                    if cand is not None:
                        if locked:
                            # Snap the tracker back onto the recognised face so it
                            # can never drift onto the wrong person.
                            tracker = _init_tracker(frame, cand)
                            lock_box = cand
                            last_seen = now
                        else:
                            if pending_box is not None and face_match._iou(cand, pending_box) >= 0.2:
                                pending_hits += 1
                            else:
                                pending_hits = 1
                            pending_box = cand
                            if pending_hits >= _CONFIRM_HITS:
                                locked = True
                                tracker = _init_tracker(frame, cand)
                                lock_box = cand
                                last_seen = now
                                pending_hits = 0
                                pending_box = None

                # 3) Decide what to draw.
                box, status = None, None
                if locked and lock_box is not None:
                    age = now - last_seen
                    if tracker is not None and age <= _MAX_TRACK_WITHOUT_RECOG:
                        box, status = lock_box, "tracking"
                    elif age <= _PERSIST_AFTER_LOSS:
                        box, status = lock_box, "last_seen"
                    else:
                        locked = False
                        lock_box = None

                face_match.draw_highlight(frame, box, status, name)
                jpeg = _encode_frame_jpeg(frame, _OUT_WIDTH)
                if jpeg is not None:
                    _set_out(track_key, jpeg, None)
        finally:
            try:
                cap.release()
            except Exception:
                pass

        if not stop_event.is_set():
            time.sleep(1.0)


def ensure_tracking(rtsp_url: str | None, emp: str, label: str | None = None) -> str | None:
    """Start (or refresh) the tracking loop for (stream, employee). Returns key."""
    if not (emp or "").strip():
        return None
    configured = (rtsp_url or "").strip() or get_configured_rtsp_url()
    if not configured:
        return None

    candidates = detect_rtsp_url_candidates(configured)
    base = candidates[0] if candidates else normalize_live_rtsp_url(configured)
    track_key = f"{base}::{emp.strip().upper()}"

    with _LOOPS_LOCK:
        info = _LOOPS.get(track_key)
        if info is not None and info["thread"].is_alive():
            info["last_req"] = time.monotonic()
            info["label"] = label
            return track_key

        stop_event = threading.Event()
        info = {
            "thread": None,
            "stop": stop_event,
            "out": None,
            "last_req": time.monotonic(),
            "label": label,
        }
        thread = threading.Thread(
            target=_loop,
            args=(track_key, candidates, emp.strip(), label, stop_event),
            daemon=True,
        )
        info["thread"] = thread
        _LOOPS[track_key] = info
        thread.start()
    return track_key


def get_tracked_jpeg(track_key: str | None) -> tuple[bytes | None, str | None]:
    """Latest annotated JPEG for a tracking key (or (None, error/None))."""
    if not track_key:
        return None, None
    with _LOOPS_LOCK:
        info = _LOOPS.get(track_key)
        out = info.get("out") if info else None
    if not out:
        return None, "warming up"
    _ts, jpeg, err = out
    return jpeg, err
