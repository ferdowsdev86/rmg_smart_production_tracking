from django.contrib import admin

from .models import CameraDetectionLog, StationCameraState


@admin.register(CameraDetectionLog)
class CameraDetectionLogAdmin(admin.ModelAdmin):
    list_display = ("id", "employee", "detected_station", "assigned_station", "is_mismatch", "confidence", "timestamp")
    list_filter = ("is_mismatch", "timestamp")


@admin.register(StationCameraState)
class StationCameraStateAdmin(admin.ModelAdmin):
    list_display = ("id", "station", "last_employee", "is_mismatch", "confidence", "updated_at")
