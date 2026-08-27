"""CRUD API for daily_machin_maintanance (daily machine maintenance log)."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from datetime import datetime

from floors.machin_maintenance_serializers import DailyMachinMaintananceSerializer
from floors.machin_maintenance_service import (
    available_machines,
    derive_daily_machine_maintenance,
    machine_name_map,
)
from floors.models import DailyMachinMaintanance


class DailyMachinMaintananceViewSet(viewsets.ModelViewSet):
    """List / create / retrieve / update / delete daily machine maintenance rows."""

    serializer_class = DailyMachinMaintananceSerializer
    queryset = DailyMachinMaintanance.objects.all().order_by("-maintenance_date", "-id")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        machine_id = params.get("machine_id")
        if machine_id not in (None, ""):
            try:
                qs = qs.filter(machine_id=int(machine_id))
            except (TypeError, ValueError):
                pass

        on_date = params.get("date")
        if on_date:
            qs = qs.filter(maintenance_date=on_date)

        status_val = (params.get("machine_status") or "").strip()
        if status_val:
            qs = qs.filter(machine_status=status_val)

        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        # Enrich machine names for whatever rows are being serialized.
        rows = getattr(self, "_serialize_rows", None)
        machin_nos = set()
        if rows is not None:
            machin_nos = {r.machine_id for r in rows}
        ctx["machine_names"] = machine_name_map(machin_nos)
        return ctx

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        self._serialize_rows = list(queryset)
        serializer = self.get_serializer(self._serialize_rows, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="available-machines")
    def available_machines(self, request):
        """GET /api/floors/daily-machin-maintanance/available-machines/

        Machines selectable for a maintenance entry — sourced from sewing_log
        rows with flag9 = 1.
        """
        return Response(available_machines())

    @action(detail=False, methods=["get"], url_path="derived")
    def derived(self, request):
        """GET /api/floors/daily-machin-maintanance/derived/?date=YYYY-MM-DD

        Daily machine maintenance derived from sewing_log (flag4 = 1),
        date-wise + machin_id-wise with an event count.
        """
        raw = (request.query_params.get("date") or "").strip()
        on_date = None
        if raw:
            try:
                on_date = datetime.strptime(raw, "%Y-%m-%d").date()
            except ValueError:
                return Response({"detail": "Invalid date. Use YYYY-MM-DD."}, status=400)
        results = derive_daily_machine_maintenance(on_date)
        return Response({"date": on_date, "count": len(results), "results": results})
