from django.db import models

from employees.models import Employee
from floors.models import WorkStation


class StationCameraState(models.Model):
    """Latest camera identity state for a workstation (GET /api/camera/status/)."""

    station = models.OneToOneField(
        WorkStation,
        on_delete=models.CASCADE,
        related_name="camera_state",
    )
    last_employee = models.ForeignKey(
        Employee,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="camera_states",
    )
    is_mismatch = models.BooleanField(default=False)
    confidence = models.FloatField(default=0.0)
    camera_id = models.CharField(max_length=50, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["station_id"]

    def __str__(self) -> str:
        return f"Camera@{self.station_id}"


class CameraDetectionLog(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="camera_logs")
    detected_station = models.ForeignKey(
        WorkStation,
        on_delete=models.CASCADE,
        related_name="detection_logs_detected",
    )
    assigned_station = models.ForeignKey(
        WorkStation,
        on_delete=models.CASCADE,
        related_name="assigned",
    )
    is_mismatch = models.BooleanField(default=False)
    confidence = models.FloatField()
    timestamp = models.DateTimeField(auto_now_add=True)
    camera_id = models.CharField(max_length=50)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["-timestamp", "is_mismatch"]),
        ]

    def __str__(self) -> str:
        return f"{self.employee} @ {self.timestamp:%Y-%m-%d %H:%M} (mismatch={self.is_mismatch})"
