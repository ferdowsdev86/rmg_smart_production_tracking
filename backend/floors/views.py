from datetime import date
from typing import Optional

from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from employees.hr_employee import hr_profile_for_associate_id
from floors.finishing_dashboard import (
    build_finishing_dashboard_payload,
    build_floor_finishing_dashboard_payload,
    default_floor_and_line,
)
from floors.models import FinishingProcess, Floor, Line, LineLayoutTemplate, ProductionEntry, WorkStation
from floors.layout_template_service import (
    bulk_hr_by_employee_ids,
    serialize_layout_template,
    serialize_layout_template_list,
    line_names_by_floor,
)
from floors.serializers import (
    FinishingProcessSerializer,
    FloorSerializer,
    LineLayoutTemplateSerializer,
    LineLayoutTemplateWriteSerializer,
    LineSerializer,
    WorkStationBulkItemSerializer,
    WorkStationSerializer,
)
from floors.services import (
    build_floor_dashboard_payload,
    build_line_detail_payload,
    efficiency_pct,
    get_today,
    hourly_for_line,
)


def _today() -> date:
    return get_today()


class OperationChoicesView(APIView):
    """GET /api/floors/operations/ — predefined operation list for station setup UI."""

    def get(self, request):
        from floors.constants import OPERATION_CHOICES

        return Response([{"value": v, "label": lbl} for v, lbl in OPERATION_CHOICES])


class FloorListView(APIView):
    """GET /api/floors/floors/ — all rows from floors_floor."""

    def get(self, request):
        qs = Floor.objects.order_by("id")
        return Response({"floors": FloorSerializer(qs, many=True).data})


class FinishingDashboardView(APIView):
    """GET /api/floors/finishing-dashboard/"""

    @staticmethod
    def _parse_filter_date(request) -> Optional[date]:
        raw = (request.query_params.get("date") or "").strip()
        if not raw:
            return timezone.localdate()
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None

    def get(self, request):
        filter_date = self._parse_filter_date(request)
        if filter_date is None:
            return Response({"detail": "Invalid date. Use YYYY-MM-DD."}, status=400)

        floor_id = request.query_params.get("floor_id")
        line_id = request.query_params.get("line_id")

        if floor_id and line_id:
            return Response(
                build_finishing_dashboard_payload(
                    int(floor_id),
                    int(line_id),
                    filter_date=filter_date,
                )
            )
        if floor_id:
            return Response(
                build_floor_finishing_dashboard_payload(int(floor_id), filter_date=filter_date)
            )

        floor, line = default_floor_and_line()
        if not floor:
            return Response(
                {
                    "title": "FINISHING-DASHBOARD",
                    "view": "all",
                    "floor": None,
                    "line": None,
                    "lines": [],
                    "line_dashboards": [],
                    "processes": [],
                    "sections": [],
                    "process_count": 0,
                    "station_total": 0,
                    "filter_date": filter_date.isoformat(),
                    "detail": "No floors_floor or floors_line rows. Run seed_floor_layout.",
                }
            )
        if line and line_id is not None:
            return Response(
                build_finishing_dashboard_payload(floor.id, line.id, filter_date=filter_date)
            )
        return Response(build_floor_finishing_dashboard_payload(floor.id, filter_date=filter_date))


class FinishingProcessListView(APIView):
    """GET /api/floors/finishing-processes/"""

    def get(self, request):
        qs = FinishingProcess.objects.filter(is_active=True).order_by("display_order")
        processes = FinishingProcessSerializer(qs, many=True).data
        station_total = sum(p["stationCount"] for p in processes)
        return Response(
            {
                "processes": processes,
                "process_count": len(processes),
                "station_total": station_total,
            }
        )


class FloorDashboardView(APIView):
    """GET /api/floors/dashboard/"""

    def get(self, request):
        return Response(build_floor_dashboard_payload())


class LineViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Line.objects.select_related("floor").all()
    serializer_class = LineSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        floor_id = self.request.query_params.get("floor")
        if floor_id:
            qs = qs.filter(floor_id=int(floor_id))
        return qs.order_by("floor_id", "line_number")

    @action(detail=True, methods=["get"], url_path="detail-dashboard")
    def detail_dashboard(self, request, pk=None):
        payload = build_line_detail_payload(int(pk))
        if not payload:
            return Response({"detail": "Not found."}, status=404)
        return Response(payload)

    @action(detail=True, methods=["get"], url_path="stations")
    def stations(self, request, pk=None):
        line = self.get_object()
        qs = WorkStation.objects.filter(line=line).order_by("station_number")
        today = _today()
        cards = []
        for st in qs:
            agg = ProductionEntry.objects.filter(station=st, date=today).aggregate(
                q=Sum("quantity"),
                t=Sum("target"),
            )
            out = int(agg["q"] or 0)
            tgt = int(agg["t"] or 0)
            if tgt == 0:
                tgt = max(line.daily_target // max(line.stations.count(), 1), 1)
            eff = efficiency_pct(out, tgt)
            associate_id = None
            profile = hr_profile_for_associate_id(associate_id) if associate_id else None
            st_status = "empty"
            if not associate_id:
                st_status = "empty"
            elif eff >= 80:
                st_status = "normal"
            elif eff >= 60:
                st_status = "behind"
            else:
                st_status = "alert"

            cards.append(
                {
                    "id": st.id,
                    "station_number": st.station_number,
                    "operation_type": st.operation_type,
                    "operation_label": st.get_operation_type_display(),
                    "symbol_icon": getattr(st, "symbol_icon", None) or st.operation_type,
                    "standard_time": st.standard_time,
                    "required_skill_level": st.required_skill_level,
                    "output_today": out,
                    "target_today": tgt,
                    "efficiency_pct": eff,
                    "status": st_status,
                    "employee_name": profile["employee_name"] if profile else None,
                    "employee_emp_id": associate_id,
                    "profile_image": None,
                }
            )
        return Response({"line_id": line.id, "date": str(today), "stations": cards})

    @action(detail=True, methods=["post"], url_path="stations/bulk")
    def stations_bulk(self, request, pk=None):
        line = self.get_object()
        raw = request.data
        if isinstance(raw, dict) and "stations" in raw:
            raw = raw["stations"]
        ser = WorkStationBulkItemSerializer(data=raw, many=True)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            for item in ser.validated_data:
                station_number = item["station_number"]
                defaults = {
                    "operation_type": item["operation_type"],
                    "machine_type": item["machine_type"],
                    "standard_time": item["standard_time"],
                    "required_skill_level": item.get("required_skill_level") or 1,
                }
                if hasattr(WorkStation, "position_x"):
                    defaults["position_x"] = item["position_x"]
                    defaults["position_y"] = item["position_y"]
                    defaults["symbol_icon"] = item.get("symbol_icon") or ""
                WorkStation.objects.update_or_create(
                    line=line,
                    station_number=station_number,
                    defaults=defaults,
                )
        return Response({"status": "ok", "updated": len(ser.validated_data)})

    @action(detail=True, methods=["post"], url_path="apply-template")
    def apply_template(self, request, pk=None):
        line = self.get_object()
        template_id = request.data.get("template_id")
        tpl = get_object_or_404(LineLayoutTemplate, pk=template_id)
        stations = tpl.stations or []
        with transaction.atomic():
            for cfg in stations:
                sn = cfg.get("station_number")
                if not sn:
                    continue
                defaults = {
                    "operation_type": cfg["operation_type"],
                    "machine_type": cfg.get("machine_type", ""),
                    "standard_time": float(cfg.get("standard_time", 0)),
                    "required_skill_level": int(cfg.get("required_skill_level", 1)),
                }
                if hasattr(WorkStation, "position_x"):
                    defaults["position_x"] = float(cfg.get("position_x", 0))
                    defaults["position_y"] = float(cfg.get("position_y", 0))
                    defaults["symbol_icon"] = cfg.get("symbol_icon", "")
                WorkStation.objects.update_or_create(
                    line=line,
                    station_number=int(sn),
                    defaults=defaults,
                )
        return Response({"status": "ok", "applied": len(stations)})


class WorkStationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    queryset = WorkStation.objects.select_related("line").all()
    serializer_class = WorkStationSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        line_id = self.request.query_params.get("line")
        if line_id:
            qs = qs.filter(line_id=line_id)
        return qs.order_by("line_id", "station_number")


class LineLayoutTemplateViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = LineLayoutTemplate.objects.select_related("floor").all()

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return LineLayoutTemplateWriteSerializer
        return LineLayoutTemplateSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        layout_type = self.request.query_params.get("layout_type")
        if layout_type:
            qs = qs.filter(layout_type=layout_type)
        floor_id = self.request.query_params.get("floor")
        if floor_id:
            qs = qs.filter(floor_id=int(floor_id))
        return qs.order_by("-updated_at", "-created_at")

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        return Response(serialize_layout_template_list(queryset))

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        floor_ids = {instance.floor_id} if instance.floor_id else set()
        line_map = line_names_by_floor(floor_ids)
        hr_map = bulk_hr_by_employee_ids([instance.employee_id])
        return Response(serialize_layout_template(instance, hr_map, line_map))

    def perform_create(self, serializer):
        serializer.save()

    def perform_update(self, serializer):
        serializer.save()


class FloorLinesMapView(APIView):
    def get(self, request):
        payload = build_floor_dashboard_payload()
        return Response({"lines": payload["lines"], "floor": payload.get("floor")})


class HourlyProductionView(APIView):
    def get(self, request):
        line_id = int(request.query_params["line_id"])
        on = request.query_params.get("date") or str(_today())
        on_date = date.fromisoformat(on)
        data = hourly_for_line(line_id, on_date)
        return Response({"line_id": line_id, "date": str(on_date), "hours": data})
