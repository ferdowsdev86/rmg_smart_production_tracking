"""RTSP live frame capture for dashboard CCTV panel (OpenCV / ffmpeg)."""

from __future__ import annotations

import logging
import os
import re
import subprocess
import threading
import time
from datetime import datetime
from urllib.parse import parse_qs, urlparse, urlunparse

from core.env import config

# Low-latency RTSP decode (must be set before OpenCV opens the stream).
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;0",
)

logger = logging.getLogger(__name__)

_CACHE_LOCK = threading.Lock()
_FRAME_COND = threading.Condition(_CACHE_LOCK)
_FRAME_CACHE: dict[str, tuple[float, bytes | None, str | None, int]] = {}
_FRAME_SEQ = 0
#
# Snapshot endpoint is polled frequently by the frontend.
# We keep the latest JPEG in memory and serve it quickly.
#
_CACHE_TTL_SECONDS = 4.0

# Background capture: one RTSP read loop per camera (keyed by primary cache URL).
# Supports several concurrent cameras (e.g. one per zone).
_BG_LOCK = threading.Lock()
_BG_THREADS: dict[str, threading.Thread] = {}
_BG_STOP_EVENTS: dict[str, threading.Event] = {}
_BG_USED_URLS: dict[str, str | None] = {}  # cache key -> actual RTSP URL in use

# Lower JPEG size to speed up encoding and network transfer.
_BG_JPEG_QUALITY = 60

# Downscale frames before encoding to keep latency low.
_BG_MAX_ENCODE_WIDTH = 854

# Face recognition needs detail: keep a high-res copy (main stream, larger encode
# width) on a separate cache key so the low-latency live view is unaffected.
_BG_DETECT_ENCODE_WIDTH = 1920
_DETECT_KEY_PREFIX = "detect::"

# Discard this many buffered RTSP frames before encoding (reduces lag vs live).
_BG_FLUSH_GRABS = 10

_MJPEG_BOUNDARY = b"frame"


def get_configured_rtsp_url() -> str:
    """Prefer explicit live URL; fall back to CAMERA_RTSP_URL."""
    live = (config("CAMERA_RTSP_LIVE_URL", default="") or "").strip()
    if live:
        return live
    return (config("CAMERA_RTSP_URL", default="") or "").strip()


def _strip_playback_query(url: str) -> str:
    parsed = urlparse(url)
    q = {
        k: v
        for k, v in parse_qs(parsed.query).items()
        if k.lower() not in {"starttime", "endtime"}
    }
    clean_query = "&".join(f"{k}={vals[0]}" for k, vals in q.items() if vals)
    return urlunparse(parsed._replace(query=clean_query))


def _hikvision_tracks_to_channels(url: str) -> str | None:
    """Hikvision live uses /Streaming/Channels/NNN; /tracks/ is often playback."""
    match = re.search(r"(rtsp://[^?]+)/Streaming/tracks/(\d+)", url, re.IGNORECASE)
    if not match:
        return None
    return f"{match.group(1)}/Streaming/Channels/{match.group(2)}"


def _hikvision_substream_url(url: str) -> str | None:
    """Hikvision substream (…02) is lower resolution but much lower latency."""
    match = re.search(r"(rtsp://[^?]+)/Streaming/Channels/(\d+)", url, re.IGNORECASE)
    if not match:
        return None
    channel_id = match.group(2)
    if not channel_id.endswith("1"):
        return None
    sub_id = f"{channel_id[:-1]}2"
    return f"{match.group(1)}/Streaming/Channels/{sub_id}"


def normalize_live_rtsp_url(url: str) -> str:
    """
    Browsers cannot play RTSP. Playback URLs are converted to live streams:
    - Dahua: /cam/playback → /cam/realmonitor
    - Hikvision: strip starttime/endtime; prefer /Streaming/Channels/ over /tracks/
    """
    raw = (url or "").strip()
    if not raw:
        return ""

    if "/cam/playback" in raw:
        parsed = urlparse(raw)
        query = parse_qs(parsed.query)
        channel = (query.get("channel") or ["1"])[0]
        base = raw.split("/cam/playback", 1)[0]
        return f"{base}/cam/realmonitor?channel={channel}&subtype=1"

    if "starttime=" in raw.lower() or "endtime=" in raw.lower():
        raw = _strip_playback_query(raw)

    channels_url = _hikvision_tracks_to_channels(raw)
    if channels_url:
        return channels_url

    return raw


def _extract_stream_id(url: str) -> str | None:
    """Channel/track number from a Hikvision URL (…/Channels/NNN or …/tracks/NNN)."""
    match = re.search(r"/Streaming/(?:Channels|tracks)/(\d+)", url or "", re.IGNORECASE)
    return match.group(1) if match else None


def to_hikvision_time(value: str | None) -> str:
    """Normalize a UI datetime into Hikvision RTSP form: YYYYMMDDTHHMMSSZ."""
    raw = (value or "").strip()
    if not raw:
        return ""
    if re.fullmatch(r"\d{8}T\d{6}Z", raw):
        return raw
    candidate = raw.replace(" ", "T").rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(candidate, fmt).strftime("%Y%m%dT%H%M%SZ")
        except ValueError:
            continue
    return raw


def build_rtsp_for_time(
    base_url: str,
    starttime: str | None = None,
    endtime: str | None = None,
) -> str:
    """
    Resolve the effective RTSP URL for a camera.

    - No start/end → current LIVE stream (times stripped, tracks→Channels).
    - start & end  → recorded PLAYBACK for that window (/Streaming/tracks/NNN).
    """
    base = (base_url or "").strip()
    if not base:
        return ""

    start = to_hikvision_time(starttime)
    end = to_hikvision_time(endtime)
    if not (start and end):
        return normalize_live_rtsp_url(base)

    stream_id = _extract_stream_id(base)
    parsed = urlparse(base)
    path = f"/Streaming/tracks/{stream_id}" if stream_id else parsed.path
    query = f"starttime={start}&endtime={end}"
    return urlunparse(parsed._replace(path=path, query=query))


def live_rtsp_url_candidates(url: str) -> list[str]:
    """Ordered fallbacks for frame capture.

    If the URL is a recorded-playback URL (has starttime/endtime), try it
    verbatim first so the recorded footage plays; otherwise prefer the
    low-latency live stream.
    """
    raw = (url or "").strip()
    primary = normalize_live_rtsp_url(raw)
    low_latency = config("CAMERA_RTSP_LOW_LATENCY", default=True, cast=bool)
    is_playback = "starttime=" in raw.lower() or "endtime=" in raw.lower()
    candidates: list[str] = []
    seen: set[str] = set()

    def add(candidate: str) -> None:
        c = (candidate or "").strip()
        if c and c not in seen:
            seen.add(c)
            candidates.append(c)

    # Recorded playback: the exact URL (with starttime/endtime) wins.
    if is_playback:
        add(raw)

    if low_latency:
        add(_hikvision_substream_url(primary) or "")

    add(primary)
    add(_hikvision_tracks_to_channels(primary) or "")
    if primary:
        add(_strip_playback_query(primary))

    tracks_match = re.search(r"(rtsp://[^?]+)/Streaming/Channels/(\d+)", primary, re.IGNORECASE)
    if tracks_match:
        add(f"{tracks_match.group(1)}/Streaming/tracks/{tracks_match.group(2)}")

    return candidates


def _encode_frame_jpeg(frame, max_width: int = _BG_MAX_ENCODE_WIDTH) -> bytes | None:
    try:
        import cv2  # type: ignore
    except ImportError:
        return None

    try:
        h, w = frame.shape[:2]
    except Exception:
        h, w = None, None
    if w and max_width and w > max_width:
        new_h = int(h * (max_width / float(w)))
        frame = cv2.resize(frame, (max_width, new_h))

    encoded_ok, encoded = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), int(_BG_JPEG_QUALITY)],
    )
    if not encoded_ok or encoded is None:
        return None
    return encoded.tobytes()


_FACE_CASCADE = None


def _get_face_cascade():
    """Lazy-load the bundled OpenCV Haar face detector (no extra deps)."""
    global _FACE_CASCADE
    if _FACE_CASCADE is None:
        import cv2  # type: ignore

        _FACE_CASCADE = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
    return _FACE_CASCADE


def annotate_faces_jpeg(jpeg_bytes: bytes | None, label: str | None = None) -> bytes | None:
    """
    Draw boxes around detected faces on a JPEG frame (detection only, not identity).

    Returns the original bytes unchanged if OpenCV/numpy are unavailable or
    decoding fails, so the live feed never breaks because of this overlay.
    """
    if not jpeg_bytes:
        return jpeg_bytes
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        return jpeg_bytes

    try:
        frame = cv2.imdecode(np.frombuffer(jpeg_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        return jpeg_bytes
    if frame is None:
        return jpeg_bytes

    try:
        cascade = _get_face_cascade()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24)
        )
        accent = (0, 230, 255)  # BGR amber/yellow
        for (x, y, w, h) in faces:
            cv2.rectangle(frame, (x, y), (x + w, y + h), accent, 2)

        text = (label or "").strip()
        if text:
            caption = f"Detecting: {text}"
            cv2.rectangle(frame, (0, 0), (frame.shape[1], 26), (0, 0, 0), -1)
            cv2.putText(
                frame, caption, (8, 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, accent, 1, cv2.LINE_AA,
            )

        ok, encoded = cv2.imencode(
            ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(_BG_JPEG_QUALITY)]
        )
        return encoded.tobytes() if ok and encoded is not None else jpeg_bytes
    except Exception:
        logger.exception("face annotation failed")
        return jpeg_bytes


def _read_fresh_frame(cap) -> object | None:
    """Grab the newest frame by flushing RTSP/ffmpeg buffers."""
    frame = None
    for _ in range(_BG_FLUSH_GRABS):
        if not cap.grab():
            break
    ok, frame = cap.retrieve()
    if ok and frame is not None:
        return frame
    ok, frame = cap.read()
    return frame if ok and frame is not None else None


def _bg_capture_loop(
    primary_cache_key: str,
    candidates: list[str],
    stop_event: threading.Event,
    max_encode_width: int = _BG_MAX_ENCODE_WIDTH,
) -> None:
    """
    Continuously captures frames in the background and updates the in-memory cache.
    This avoids re-opening RTSP on every snapshot request (which is slow).
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        _cache_set(primary_cache_key, None, "opencv-python-headless not installed on API server")
        return

    while not stop_event.is_set():
        used_url = None
        cap = None
        err: str | None = None

        # Find a URL that opens, in order.
        for candidate in candidates:
            if stop_event.is_set():
                break
            cap = cv2.VideoCapture(candidate, cv2.CAP_FFMPEG)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                used_url = candidate
                err = None
                break
            try:
                cap.release()
            except Exception:
                pass
            cap = None
            err = "Could not open RTSP stream (check URL/credentials/network)"

        with _BG_LOCK:
            _BG_USED_URLS[primary_cache_key] = used_url

        if stop_event.is_set():
            break

        if cap is None or used_url is None:
            _cache_set(primary_cache_key, None, err or "Could not open RTSP stream")
            time.sleep(3.0)
            continue

        # Read/encode as fast as possible; always flush buffers for minimum lag.
        try:
            while not stop_event.is_set():
                frame = _read_fresh_frame(cap)
                if frame is None:
                    err = "RTSP read failed"
                    break

                jpeg = _encode_frame_jpeg(frame, max_encode_width)
                if jpeg is None:
                    err = "Failed to encode frame"
                    continue

                _cache_set(primary_cache_key, jpeg, None)
        finally:
            try:
                cap.release()
            except Exception:
                pass

        # If we got here, read failed. Wait a bit and try again.
        _cache_set(primary_cache_key, None, err or "Camera read loop restarted")
        time.sleep(2.0)


def _ensure_background_capture(
    primary_cache_key: str,
    candidates: list[str],
    max_encode_width: int = _BG_MAX_ENCODE_WIDTH,
) -> None:
    """
    Starts/keeps a background capture thread per camera URL.

    Multiple cameras (e.g. one per zone) each get their own loop, keyed by
    the primary cache URL, so requesting different zones does not tear down
    another zone's stream.
    """
    with _BG_LOCK:
        existing = _BG_THREADS.get(primary_cache_key)
        if existing is not None and existing.is_alive():
            return

        stop_event = threading.Event()
        _BG_STOP_EVENTS[primary_cache_key] = stop_event
        _BG_USED_URLS[primary_cache_key] = None

        thread = threading.Thread(
            target=_bg_capture_loop,
            args=(primary_cache_key, candidates, stop_event, max_encode_width),
            daemon=True,
        )
        _BG_THREADS[primary_cache_key] = thread
        thread.start()


def _cache_get(key: str) -> tuple[bytes | None, str | None, int] | None:
    with _FRAME_COND:
        entry = _FRAME_CACHE.get(key)
        if not entry:
            return None
        ts, data, err, seq = entry
        if time.monotonic() - ts > _CACHE_TTL_SECONDS:
            return None
        return data, err, seq


def _cache_get_latest(key: str) -> tuple[bytes | None, str | None, int] | None:
    """Latest cached frame for snapshot serving (may be older than TTL)."""
    with _FRAME_COND:
        entry = _FRAME_CACHE.get(key)
        if not entry:
            return None
        _ts, data, err, seq = entry
        return data, err, seq


def _cache_set(key: str, data: bytes | None, err: str | None) -> None:
    global _FRAME_SEQ
    with _FRAME_COND:
        _FRAME_SEQ += 1
        _FRAME_CACHE[key] = (time.monotonic(), data, err, _FRAME_SEQ)
        _FRAME_COND.notify_all()


def _prepare_live_stream(rtsp_url: str | None = None) -> tuple[str, list[str], str]:
    configured = (rtsp_url or "").strip() or get_configured_rtsp_url()
    if not configured:
        return "", [], ""
    candidates = live_rtsp_url_candidates(configured)
    primary_url = candidates[0] if candidates else normalize_live_rtsp_url(configured)
    _ensure_background_capture(primary_url, candidates)
    return configured, candidates, primary_url


def iter_mjpeg_stream(rtsp_url: str | None = None) -> bytes:
    """Yield multipart MJPEG chunks pushed as soon as new frames arrive."""
    _, _, primary_url = _prepare_live_stream(rtsp_url)
    if not primary_url:
        return

    last_seq = 0
    stale_loops = 0

    while True:
        cached = _cache_get(primary_url)
        if cached is not None:
            data, err, seq = cached
            if data and seq > last_seq:
                last_seq = seq
                stale_loops = 0
                yield (
                    b"--"
                    + _MJPEG_BOUNDARY
                    + b"\r\nContent-Type: image/jpeg\r\n\r\n"
                    + data
                    + b"\r\n"
                )
                continue
            if err and stale_loops == 0:
                logger.warning("mjpeg stream waiting: %s", err)

        stale_loops += 1
        with _FRAME_COND:
            _FRAME_COND.wait(timeout=0.04 if stale_loops < 50 else 0.15)


def _capture_opencv(rtsp_url: str) -> tuple[bytes | None, str | None]:
    try:
        import cv2  # type: ignore
    except ImportError:
        return None, "opencv-python-headless not installed on API server"

    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap.release()
        return None, "Could not open RTSP stream (check URL, credentials, and network)"

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        frame = None
        for _ in range(8):
            grabbed = cap.grab()
            if not grabbed:
                break
            ok, frame = cap.retrieve()
            if ok and frame is not None:
                break
        if frame is None:
            return None, "No frame received from camera"
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            return None, "Failed to encode frame"
        return encoded.tobytes(), None
    finally:
        cap.release()


def _capture_ffmpeg(rtsp_url: str) -> tuple[bytes | None, str | None]:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        rtsp_url,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=12, check=False)
    except FileNotFoundError:
        return None, "ffmpeg not found on API server"
    except subprocess.TimeoutExpired:
        return None, "ffmpeg timed out reading RTSP stream"

    if proc.returncode != 0 or not proc.stdout:
        err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        return None, err or "ffmpeg could not read RTSP stream"
    return proc.stdout, None


def capture_live_jpeg(rtsp_url: str | None = None) -> tuple[bytes | None, str | None, str]:
    """
    Returns (jpeg_bytes, error_message, effective_rtsp_url).

    Never opens RTSP on the request thread — only serves frames from the
    background capture loop so Daphne/ASGI workers stay responsive.
    """
    configured, _candidates, primary_url = _prepare_live_stream(rtsp_url)
    if not configured:
        return None, "CAMERA_RTSP_LIVE_URL or CAMERA_RTSP_URL is not set", ""

    cached = _cache_get_latest(primary_url)
    if cached is not None and cached[0] is not None:
        with _BG_LOCK:
            used = _BG_USED_URLS.get(primary_url) or primary_url
        return cached[0], cached[1], used

    err = cached[1] if cached else None
    with _BG_LOCK:
        used = _BG_USED_URLS.get(primary_url) or primary_url
    return None, err or "Camera warming up — waiting for first frame", used or primary_url


def detect_rtsp_url_candidates(url: str) -> list[str]:
    """Ordered fallbacks for face-recognition capture.

    Unlike the live view, detection needs maximum detail, so the low-latency
    substream is intentionally skipped in favour of the main/full-res stream.
    """
    raw = (url or "").strip()
    primary = normalize_live_rtsp_url(raw)
    is_playback = "starttime=" in raw.lower() or "endtime=" in raw.lower()
    candidates: list[str] = []
    seen: set[str] = set()

    def add(candidate: str) -> None:
        c = (candidate or "").strip()
        if c and c not in seen:
            seen.add(c)
            candidates.append(c)

    # Recorded playback already streams at main resolution — use it verbatim.
    if is_playback:
        add(raw)

    add(primary)
    add(_hikvision_tracks_to_channels(primary) or "")
    if primary:
        add(_strip_playback_query(primary))
    return candidates


def capture_detect_jpeg(rtsp_url: str | None = None) -> tuple[bytes | None, str | None, str]:
    """High-resolution frame for face recognition (separate from the live view).

    Returns (jpeg_bytes, error_message, effective_rtsp_url). Runs its own
    background capture loop keyed under ``detect::`` so it never disturbs the
    low-latency live stream.
    """
    configured = (rtsp_url or "").strip() or get_configured_rtsp_url()
    if not configured:
        return None, "CAMERA_RTSP_LIVE_URL or CAMERA_RTSP_URL is not set", ""

    candidates = detect_rtsp_url_candidates(configured)
    base = candidates[0] if candidates else normalize_live_rtsp_url(configured)
    key = _DETECT_KEY_PREFIX + base
    _ensure_background_capture(key, candidates, _BG_DETECT_ENCODE_WIDTH)

    cached = _cache_get_latest(key)
    if cached is not None and cached[0] is not None:
        with _BG_LOCK:
            used = _BG_USED_URLS.get(key) or base
        return cached[0], cached[1], used

    err = cached[1] if cached else None
    with _BG_LOCK:
        used = _BG_USED_URLS.get(key) or base
    return None, err or "Camera warming up — waiting for first frame", used or base


def mask_rtsp_url(url: str) -> str:
    """Hide password in logs/API responses."""
    return re.sub(r":([^:@/]+)@", ":***@", url or "")
