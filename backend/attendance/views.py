import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from attendance.models import CameraDetectionLog, StationCameraState
from attendance.serializers import CameraAlertSerializer, StationCameraStateSerializer
from employees.models import Employee
from floors.models import WorkStation

logger = logging.getLogger(__name__)


class CameraAlertView(APIView):
    """POST /api/camera/alert/ — ingest detection events (camera service or edge device)."""

    def post(self, request):
        ser = CameraAlertSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        employee = get_object_or_404(Employee, emp_id=data["employee_emp_id"])
        detected = get_object_or_404(WorkStation, pk=data["detected_station_id"])
        assigned = get_object_or_404(WorkStation, pk=data["assigned_station_id"])
        is_mismatch = detected.id != assigned.id

        log = CameraDetectionLog.objects.create(
            employee=employee,
            detected_station=detected,
            assigned_station=assigned,
            is_mismatch=is_mismatch,
            confidence=data["confidence"],
            camera_id=data["camera_id"],
        )

        StationCameraState.objects.update_or_create(
            station=detected,
            defaults={
                "last_employee": employee,
                "is_mismatch": is_mismatch,
                "confidence": data["confidence"],
                "camera_id": data["camera_id"],
            },
        )

        channel_layer = get_channel_layer()
        payload = {
            "type": "camera.mismatch" if is_mismatch else "camera.ok",
            "log_id": log.id,
            "employee": {"name": employee.name, "emp_id": employee.emp_id, "photo": None},
            "assigned_station": {
                "id": assigned.id,
                "label": f"{assigned.line.name} S{assigned.station_number}",
            },
            "detected_station": {
                "id": detected.id,
                "label": f"{detected.line.name} S{detected.station_number}",
            },
            "is_mismatch": is_mismatch,
            "confidence": data["confidence"],
        }
        if employee.profile_image:
            payload["employee"]["photo"] = request.build_absolute_uri(employee.profile_image.url)

        async_to_sync(channel_layer.group_send)(
            "camera_alerts",
            {"type": "camera.alert", "payload": payload},
        )

        return Response({"status": "logged", "id": log.id}, status=status.HTTP_201_CREATED)


class CameraStatusView(APIView):
    """GET /api/camera/status/"""

    def get(self, request):
        qs = StationCameraState.objects.select_related("station", "station__line", "last_employee").all()
        ser = StationCameraStateSerializer(qs, many=True)
        return Response({"stations": ser.data})


class CameraStatusDetailView(APIView):
    """GET /api/camera/status/<station_id>/"""

    def get(self, request, station_id):
        st = get_object_or_404(StationCameraState.objects.select_related("station", "last_employee"), station_id=station_id)
        return Response(StationCameraStateSerializer(st).data)
