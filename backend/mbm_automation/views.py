from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.camera_data_views import CameraIngestPermission
from mbm_automation.models import FabricDefect, LineLayout, SewingLog
from mbm_automation.serializers import FabricDefectSerializer, SewingLogSerializer
from mbm_automation.services import (
    build_sewing_line_dashboard,
    build_sewing_rfid_device_payload,
    list_sewing_lines,
)


def _parse_log_date(request):
    """Optional query ?date=YYYY-MM-DD (logged_at date filter)."""
    date_str = request.query_params.get("date")
    if not date_str:
        return None, None
    date_str = date_str.strip()
    if not date_str:
        return None, None
    from datetime import datetime

    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date(), None
    except ValueError:
        return None, Response(
            {"detail": "Invalid date. Use YYYY-MM-DD (logged_at calendar day)."},
            status=400,
        )


class FabricDefectViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only access to `mbm_automation.fabricdifact`."""

    queryset = FabricDefect.objects.all().order_by("-created_at", "-id")
    serializer_class = FabricDefectSerializer


class SewingLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only access to `mbm_automation.sewing_log`."""

    queryset = SewingLog.objects.all().order_by("-logged_at", "-id")
    serializer_class = SewingLogSerializer


class SewingLineListView(APIView):
    """GET /api/automation/sewing-lines/ — lines from `line_layout`."""

    def get(self, request):
        return Response({"lines": list_sewing_lines()})


class SewingLineDashboardView(APIView):
    """GET /api/automation/sewing-lines/<floor>/<line_no>/dashboard/?date=YYYY-MM-DD"""

    def get(self, request, floor: int, line_no: int):
        if not LineLayout.objects.filter(floor=floor, line_no=line_no).exists():
            return Response({"detail": "Line not found in line_layout."}, status=404)
        on_date, err = _parse_log_date(request)
        if err is not None:
            return err
        try:
            payload = build_sewing_line_dashboard(floor=floor, line_no=line_no, on_date=on_date)
        except Exception as exc:
            return Response(
                {"detail": f"Failed to build sewing line dashboard: {exc}"},
                status=500,
            )
        return Response(payload)


class SewingRfidDeviceView(APIView):
    """GET /api/automation/sewing-rfid-device/?machin_id=&machin_user=&date=YYYY-MM-DD"""

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        machin_id_raw = (request.query_params.get("machin_id") or "").strip()
        machin_user = (request.query_params.get("machin_user") or "").strip()
        on_date, err = _parse_log_date(request)
        if err is not None:
            return err

        if not on_date:
            return Response(
                {"detail": "date query param is required (YYYY-MM-DD login date)."},
                status=400,
            )
        if not machin_id_raw:
            return Response({"detail": "machin_id query param is required."}, status=400)
        if not machin_user:
            return Response({"detail": "machin_user query param is required."}, status=400)

        try:
            machin_id = int(machin_id_raw)
        except (TypeError, ValueError):
            return Response({"detail": "machin_id must be an integer."}, status=400)

        record = build_sewing_rfid_device_payload(
            machin_id=machin_id,
            machin_user=machin_user,
            on_date=on_date,
        )
        if record is None:
            return Response(
                {"detail": "No sewing_log data for this machin_id, machin_user, and date."},
                status=404,
            )
        return Response(record)
