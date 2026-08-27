"""
OpenCV + DeepFace camera worker.

Run as a separate process/container; POST detection events to Django `/api/camera/alert/`
with a JWT. Keeps heavy ML deps out of the main API container.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)


class CameraDetector:
    """Captures frames, compares faces to enrolled encodings, raises mismatch events."""

    def __init__(self, camera_id: str | int, station_id: int, api_base: str, api_token: str):
        self.camera_id = str(camera_id)
        self.station_id = station_id
        self.api_base = api_base.rstrip("/")
        self.api_token = api_token
        self.cap = None
        self._encodings: dict[str, Any] = {}

    def open_capture(self) -> None:
        import cv2  # type: ignore

        self.cap = cv2.VideoCapture(self.camera_id)

    def load_employee_encodings(self) -> dict[str, Any]:
        """Fetch employees with encodings from API (implement list endpoint or reuse admin export)."""
        # Placeholder: integrate GET /api/employees/ with encodings in production.
        return self._encodings

    def detect_and_identify(self, frame: Any) -> dict[str, Any]:
        """Run DeepFace on the frame — stub returns no match."""
        try:
            from deepface import DeepFace  # type: ignore
        except Exception as exc:  # pragma: no cover
            logger.warning("DeepFace not available: %s", exc)
            return {"match": None, "confidence": 0.0}

        # Example path for production:
        # result = DeepFace.find(img_path=frame, db_path="...", enforce_detection=False)
        return {"match": None, "confidence": 0.0, "note": "Wire DeepFace.find + DB path"}

    def _post_alert(
        self,
        *,
        emp_id: str,
        detected_station_id: int,
        assigned_station_id: int,
        confidence: float,
    ) -> None:
        url = f"{self.api_base}/api/camera/alert/"
        payload = {
            "employee_emp_id": emp_id,
            "detected_station_id": detected_station_id,
            "assigned_station_id": assigned_station_id,
            "confidence": confidence,
            "camera_id": self.camera_id,
        }
        headers = {"Authorization": f"Bearer {self.api_token}"}
        requests.post(url, json=payload, headers=headers, timeout=10)

    def run(self) -> None:
        """Continuous loop: capture → detect → compare → alert + periodic heartbeat."""
        if not self.cap:
            self.open_capture()
        last_status = 0.0
        try:
            import cv2  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("OpenCV required") from exc

        while True:
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.2)
                continue

            _ = self.detect_and_identify(frame)

            if time.time() - last_status > 5:
                # Optionally POST summary metrics or rely on Django state model
                last_status = time.time()

            time.sleep(0.05)
        # Unreachable — add graceful shutdown in real deployment
