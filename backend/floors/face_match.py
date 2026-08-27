"""Indicate a specific employee in a live frame via face recognition.

Uses OpenCV's bundled YuNet (detection) + SFace (recognition) ONNX models —
no extra pip dependencies. The employee's HR photo (hr_as_basic_info.as_pic)
is used as the reference; the best-matching face in the frame is highlighted.

Everything degrades gracefully: if models are missing, the reference photo
cannot be loaded, or anything fails, callers fall back to plain detection.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np

from core.env import config
from employees.hr_employee import find_hr_row
from mbm_automation.hr_lookup import build_hr_photo_url

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent / "cv_models"
_YUNET_PATH = _MODELS_DIR / "face_detection_yunet_2023mar.onnx"
_SFACE_PATH = _MODELS_DIR / "face_recognition_sface_2021dec.onnx"

_LOCK = threading.Lock()
_DETECTOR = None
_RECOGNIZER = None

# employee_id (upper) -> reference embedding (np.ndarray) or None if unavailable.
_REF_CACHE: dict[str, np.ndarray | None] = {}

# Throttle recognition so polling doesn't re-run heavy inference every frame.
_ANNOT_CACHE: dict[str, tuple[float, bytes]] = {}
_ANNOT_TTL = 0.6


def models_available() -> bool:
    return _YUNET_PATH.is_file() and _SFACE_PATH.is_file()


def _match_threshold() -> float:
    # SFace "same identity" cosine is ~0.363. Keep it at/above that so we don't
    # box the wrong person; the correct match usually scores noticeably higher.
    return float(config("CAMERA_FACE_MATCH_THRESHOLD", default=0.38, cast=float))


def _match_margin() -> float:
    # The best face must beat the 2nd-best by this much, otherwise the match is
    # ambiguous (two similar-looking people) and we show nothing.
    return float(config("CAMERA_FACE_MATCH_MARGIN", default=0.10, cast=float))


# Upscale small frames before detection so distant/tiny faces still register.
_DETECT_TARGET_WIDTH = 1280
# Keep the highlight box clearly visible even when the face is tiny on screen.
_MIN_BOX_FRACTION = 0.07

# --- Multi-frame confirmation / tracking ---------------------------------
# Don't trust a single frame: only lock onto the target after it matches in a
# few recent frames at roughly the same spot. This removes transient wrong
# matches (a look-alike scoring high for one instant) and stabilises the box.
_CONFIRM_HITS = 2            # consecutive overlapping confident matches required
_CONFIRM_WINDOW = 2.0        # seconds within which hits must accumulate
_MATCH_PERSIST_SECONDS = 1.5  # keep showing the locked box this long after a miss
_TRACK_IOU = 0.2             # overlap to treat two detections as the same person
_BOX_SMOOTH = 0.5            # EMA factor for jitter-free box motion
# emp key -> {box, ts, hits, confirmed_ts}
_TRACK_STATE: dict[str, dict] = {}


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _ema_box(old, new, alpha):
    return tuple(int(round(o * (1 - alpha) + n * alpha)) for o, n in zip(old, new))


def _padded_box(face, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
    """Enlarged, clamped, min-size box around a detected face row."""
    x, y, w, h = (int(face[0]), int(face[1]), int(face[2]), int(face[3]))
    pad_x = int(w * 0.6)
    pad_top = int(h * 0.6)
    pad_bottom = int(h * 1.3)
    x1, y1 = x - pad_x, y - pad_top
    x2, y2 = x + w + pad_x, y + h + pad_bottom

    min_side = max(80, int(frame_w * _MIN_BOX_FRACTION))
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    half_w = max((x2 - x1) // 2, min_side // 2)
    half_h = max((y2 - y1) // 2, min_side // 2)
    x1, x2 = cx - half_w, cx + half_w
    y1, y2 = cy - half_h, cy + half_h

    x1 = max(0, min(x1, frame_w - 1))
    y1 = max(0, min(y1, frame_h - 1))
    x2 = max(x1 + 1, min(x2, frame_w))
    y2 = max(y1 + 1, min(y2, frame_h))
    return (x1, y1, x2, y2)


def _confirm_track(key: str, candidate, now: float):
    """Stateful confirmation. Returns (box_to_draw | None, status).

    status: 'tracking' (live confirmed), 'last_seen' (persisted), or None.
    """
    st = _TRACK_STATE.get(key)
    if candidate is not None:
        if st and (now - st["ts"]) <= _CONFIRM_WINDOW and _iou(candidate, st["box"]) >= _TRACK_IOU:
            hits = st["hits"] + 1
            box = _ema_box(st["box"], candidate, _BOX_SMOOTH)
        else:
            hits = 1
            box = candidate
        confirmed = hits >= _CONFIRM_HITS
        _TRACK_STATE[key] = {
            "box": box,
            "ts": now,
            "hits": hits,
            "confirmed_ts": now if confirmed else (st.get("confirmed_ts", 0.0) if st else 0.0),
        }
        return (box, "tracking") if confirmed else (None, None)

    # No candidate in this frame: briefly hold the last confirmed position.
    if st and st["hits"] >= _CONFIRM_HITS and (now - st["ts"]) <= _MATCH_PERSIST_SECONDS:
        return st["box"], "last_seen"
    if st and (now - st["ts"]) > _CONFIRM_WINDOW:
        _TRACK_STATE.pop(key, None)
    return None, None


def _get_detector(width: int, height: int):
    import cv2  # type: ignore

    global _DETECTOR
    if _DETECTOR is None:
        # Lower score threshold (0.5) to surface smaller, less-frontal faces.
        _DETECTOR = cv2.FaceDetectorYN.create(
            str(_YUNET_PATH), "", (width, height), 0.5, 0.3, 5000
        )
    else:
        _DETECTOR.setInputSize((width, height))
    return _DETECTOR


def _get_recognizer():
    import cv2  # type: ignore

    global _RECOGNIZER
    if _RECOGNIZER is None:
        _RECOGNIZER = cv2.FaceRecognizerSF.create(str(_SFACE_PATH), "")
    return _RECOGNIZER


def _detect_faces(frame):
    import cv2  # type: ignore

    h, w = frame.shape[:2]
    # Upscale narrow frames so small/distant faces become detectable. Coordinates
    # are mapped back to the original frame afterwards.
    scale = 1.0
    detect_frame = frame
    if 0 < w < _DETECT_TARGET_WIDTH:
        scale = _DETECT_TARGET_WIDTH / float(w)
        detect_frame = cv2.resize(
            frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LINEAR
        )
    dh, dw = detect_frame.shape[:2]
    detector = _get_detector(dw, dh)
    _retval, faces = detector.detect(detect_frame)
    if faces is None:
        return []
    if scale != 1.0:
        faces = faces.copy()
        # First 14 values are coordinates (bbox + 5 landmark x/y); index 14 is score.
        faces[:, 0:14] = faces[:, 0:14] / scale
    return faces


def _embedding_for_face(frame, face_row):
    recognizer = _get_recognizer()
    aligned = recognizer.alignCrop(frame, face_row)
    feat = recognizer.feature(aligned)
    return feat.copy()


def _fetch_image(url: str):
    import cv2  # type: ignore

    try:
        req = Request(url, headers={"User-Agent": "sff-face-match"})
        with urlopen(req, timeout=6) as resp:  # noqa: S310 (trusted internal HR host)
            data = resp.read()
    except Exception as exc:
        logger.warning("HR photo fetch failed (%s): %s", url, exc)
        return None
    if not data:
        return None
    return cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)


def _reference_embedding(employee_id: str):
    key = (employee_id or "").strip().upper()
    if not key:
        return None
    if key in _REF_CACHE:
        return _REF_CACHE[key]

    embedding = None
    row = find_hr_row(key)
    photo_url = build_hr_photo_url(row.as_pic) if row else None
    if photo_url:
        image = _fetch_image(photo_url)
        if image is not None:
            faces = _detect_faces(image)
            if len(faces) > 0:
                best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
                try:
                    embedding = _embedding_for_face(image, best)
                except Exception:
                    logger.exception("reference embedding failed for %s", key)
    _REF_CACHE[key] = embedding
    return embedding


def _cosine(recognizer, feat_a, feat_b) -> float:
    import cv2  # type: ignore

    return float(recognizer.match(feat_a, feat_b, cv2.FaceRecognizerSF_FR_COSINE))


def draw_highlight(frame, box, status: str | None, name: str) -> None:
    """Draw the red highlight box, label and status banner on ``frame`` in place.

    ``box`` is (x1, y1, x2, y2) or None. ``status`` is 'tracking', 'last_seen'
    or None. Shared by the per-frame and continuous-tracking code paths.
    """
    import cv2  # type: ignore

    red = (0, 0, 255)
    frame_h, frame_w = frame.shape[:2]
    name = (name or "").strip() or "target"

    if box is not None:
        x1, y1, x2, y2 = box
        thickness = max(4, int(frame_w / 320))
        cv2.rectangle(frame, (x1, y1), (x2, y2), red, thickness)

        text = name if status == "tracking" else f"{name} (last seen)"
        fs = max(0.7, frame_w / 1400.0)
        ft = max(2, int(fs * 2))
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, fs, ft)
        ty = max(th + 8, y1)
        cv2.rectangle(frame, (x1, ty - th - 8), (x1 + tw + 12, ty + 4), red, -1)
        cv2.putText(
            frame, text, (x1 + 6, ty),
            cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), ft, cv2.LINE_AA,
        )

    banner = f"Tracking: {name}" if box is not None else f"Searching for {name}..."
    bh = max(26, int(frame_h * 0.045))
    cv2.rectangle(frame, (0, 0), (frame_w, bh), (0, 0, 0), -1)
    bfs = max(0.55, frame_w / 1600.0)
    cv2.putText(
        frame, banner, (8, int(bh * 0.7)),
        cv2.FONT_HERSHEY_SIMPLEX, bfs, red, 2, cv2.LINE_AA,
    )


def locate_employee(frame, employee_id: str):
    """Find the best confident, unambiguous face for ``employee_id`` in ``frame``.

    Returns (box | None, best_score). ``box`` is an enlarged (x1,y1,x2,y2)
    region only when the match passes both the threshold and the margin test.
    """
    if frame is None or not (employee_id or "").strip() or not models_available():
        return None, -1.0
    try:
        import cv2  # type: ignore  # noqa: F401
    except ImportError:
        return None, -1.0

    key = employee_id.strip().upper()
    with _LOCK:
        reference = _reference_embedding(key)
        if reference is None:
            return None, -1.0
        try:
            faces = _detect_faces(frame)
            recognizer = _get_recognizer()
            best_idx, best_score = -1, -1.0
            scores: list[float] = []
            for i, face in enumerate(faces):
                try:
                    score = _cosine(recognizer, reference, _embedding_for_face(frame, face))
                except Exception:
                    score = -1.0
                scores.append(score)
                if score > best_score:
                    best_idx, best_score = i, score

            second_best = sorted(scores, reverse=True)[1] if len(scores) > 1 else -1.0
            margin_ok = (best_score - second_best) >= _match_margin()
            if best_idx >= 0 and best_score >= _match_threshold() and margin_ok:
                fh, fw = frame.shape[:2]
                return _padded_box(faces[best_idx], fw, fh), best_score
            return None, best_score
        except Exception:
            logger.exception("locate_employee failed")
            return None, -1.0


def recognize_and_annotate(
    jpeg_bytes: bytes | None,
    employee_id: str,
    label: str | None = None,
) -> bytes | None:
    """
    Draw a highlight on the frame face that matches ``employee_id``.

    Returns annotated JPEG bytes, or None if recognition is unavailable
    (missing models / no reference photo) so the caller can fall back.
    """
    if not jpeg_bytes or not (employee_id or "").strip() or not models_available():
        return None

    key = employee_id.strip().upper()
    now = time.monotonic()
    cached = _ANNOT_CACHE.get(key)
    if cached and now - cached[0] < _ANNOT_TTL:
        return cached[1]

    try:
        import cv2  # type: ignore
    except ImportError:
        return None

    if _reference_embedding(key) is None:
        return None

    frame = cv2.imdecode(np.frombuffer(jpeg_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return None

    try:
        frame_h, frame_w = frame.shape[:2]

        # A single confident, unambiguous face is only a *candidate*; it must be
        # confirmed across frames before we lock the highlight onto it.
        candidate, _score = locate_employee(frame, key)
        box, status = _confirm_track(key, candidate, now)

        draw_highlight(frame, box, status, (label or employee_id).strip())

        # Detection ran at full detail; shrink for lighter browser transfer.
        out_w = 1280
        if frame_w > out_w:
            out_h = int(frame_h * (out_w / float(frame_w)))
            frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)

        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        if not ok or encoded is None:
            return None
        result = encoded.tobytes()
        _ANNOT_CACHE[key] = (now, result)
        return result
    except Exception:
        logger.exception("face recognition annotation failed")
        return None
