"""POST daily_sewing_target — return daily style/target for a machine (no sewing_log row).

IoT-friendly endpoint with a compact response:
machin_id, style, target_qty, hour_target, date, floor, line, layout_id

hour_target = round(target_qty / (target_hour - (break_end - break_st))).
Break duration minutes become a fractional hour before subtracting.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.camera_data_views import CameraIngestPermission
from mbm_automation.automation_api_urls import daily_sewing_target_urls
from mbm_automation.day_sew_target_views import (
    DaySewTargetInputSerializer,
    _parse_on_date,
    _parse_post_payload,
    _resolve_day_sew_target,
)
from mbm_automation.iotdatastore_views import _sewing_log_on_date


def _compact_target(payload: dict) -> dict:
    """Trim to the fields the IoT display needs: target_qty, hour_target and
    the CURRENT style (the latest entry in daily_line_style_targets)."""
    styles = payload.get("styles") or []
    return {
        "target_qty": payload.get("target_qty", 0),
        "hour_target": payload.get("hour_target", 0),
        "style": (styles[-1] if styles else payload.get("style") or ""),
    }


class DailySewingTargetView(APIView):
    """GET/POST /api/automation/daily_sewing_target/ — compact daily target lookup."""

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        machin_raw = (request.query_params.get("machin_id") or "").strip()
        if machin_raw:
            try:
                machin_id = int(machin_raw)
            except (TypeError, ValueError):
                return Response({"detail": "Invalid machin_id."}, status=400)
            on_date = _parse_on_date(request.query_params.get("date"))
            try:
                payload = _resolve_day_sew_target(machin_id, on_date)
            except Exception as exc:
                return Response(
                    {"detail": "Failed to resolve daily target.", "error": str(exc)},
                    status=503,
                )
            return Response(_compact_target(payload))

        return Response(
            {
                "status": "ok",
                **daily_sewing_target_urls(),
                "endpoint": "/api/automation/daily_sewing_target/",
                "methods": ["GET", "POST"],
                "auth": "DEBUG mode: no key required. Production: X-API-Key header, ?api_key=, or api_key in JSON.",
                "get_params": {
                    "machin_id": "required for target lookup",
                    "date": "optional YYYY-MM-DD (default today)",
                },
                "post_fields": {
                    "machin_id": "required",
                    "logged_at": "optional ISO datetime (date used for target lookup)",
                },
                "post_example": {"machin_id": 2233, "logged_at": "2026-07-01T12:25:55"},
                "response_example": {
                    "target_qty": 950,
                    "hour_target": 95,
                    "style": "5565-XYZ",
                },
            }
        )

    def post(self, request):
        serializer = DaySewTargetInputSerializer(data=_parse_post_payload(request))
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        machin_id = serializer.validated_data["machin_id"]
        logged_at = serializer.validated_data.get("logged_at") or timezone.now()
        if timezone.is_naive(logged_at):
            logged_at = timezone.make_aware(logged_at)
        on_date = _sewing_log_on_date(logged_at)

        try:
            payload = _resolve_day_sew_target(machin_id, on_date)
        except Exception as exc:
            return Response(
                {"detail": "Failed to resolve daily target.", "error": str(exc)},
                status=503,
            )
        return Response(_compact_target(payload), status=status.HTTP_200_OK)
