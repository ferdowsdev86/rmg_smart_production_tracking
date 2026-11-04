"""REST API for the Sewing Line Layout Planner."""

from rest_framework import viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from line_planner import services
from line_planner.assignment import assign_machines, available_machines
from line_planner.models import Layout, Machine, MachineType, PlannerLine, Style
from line_planner.serializers import (
    LayoutListSerializer,
    LayoutSerializer,
    MachineSerializer,
    MachineTypeSerializer,
    PlannerLineSerializer,
    StyleListSerializer,
    StyleSerializer,
)


class MachineTypeViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MachineType.objects.all()
    serializer_class = MachineTypeSerializer


class PlannerLineViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PlannerLine.objects.all()
    serializer_class = PlannerLineSerializer


class StyleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Style.objects.prefetch_related("operations__machine_type").all()

    def get_serializer_class(self):
        return StyleListSerializer if self.action == "list" else StyleSerializer


class MachineViewSet(viewsets.ModelViewSet):
    serializer_class = MachineSerializer
    queryset = Machine.objects.select_related("machine_type").all()

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("search"):
            qs = qs.filter(machine_no__icontains=p["search"].strip())
        if p.get("type"):
            qs = qs.filter(machine_type__code=p["type"])
        if p.get("line"):
            qs = qs.filter(current_line=p["line"])
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        return qs


class LayoutViewSet(viewsets.ModelViewSet):
    queryset = Layout.objects.select_related("style", "line").all()
    http_method_names = ["get", "delete"]  # created via /save/

    def get_serializer_class(self):
        return LayoutListSerializer if self.action == "list" else LayoutSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("style"):
            qs = qs.filter(style_id=p["style"])
        if p.get("line"):
            qs = qs.filter(line_id=p["line"])
        return qs


def _f(val, default=None):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _i(val, default=None):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


@api_view(["POST"])
def generate_view(request):
    """POST /api/line-planner/generate/

    Body: {style_id, line_id, manpower?, target_per_hour?, efficiency?,
    working_hours?, assign?}. Returns the balanced layout (and machine
    assignment when assign=true — the "Generate and assign" button).
    """
    d = request.data or {}
    style_id = _i(d.get("style_id"))
    line_id = _i(d.get("line_id"))
    if not style_id or not line_id:
        return Response({"detail": "style_id and line_id are required."}, status=400)
    manpower = _i(d.get("manpower"))
    target = _f(d.get("target_per_hour"))
    if not manpower and not target:
        return Response({"detail": "Provide manpower or target_per_hour."}, status=400)
    try:
        result = services.generate(
            style_id,
            line_id,
            manpower=manpower,
            target_per_hour=target,
            efficiency=_f(d.get("efficiency"), 0.6),
            working_hours=_f(d.get("working_hours"), 8.0),
            assign=bool(d.get("assign")),
        )
    except (Style.DoesNotExist, PlannerLine.DoesNotExist):
        return Response({"detail": "Style or line not found."}, status=404)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)
    return Response(result)


@api_view(["POST"])
def assign_view(request):
    """POST /api/line-planner/assign/  Body: {line_id, stations:[...]}."""
    d = request.data or {}
    line_id = _i(d.get("line_id"))
    stations = d.get("stations")
    if not line_id or not isinstance(stations, list):
        return Response({"detail": "line_id and stations[] are required."}, status=400)
    try:
        line = PlannerLine.objects.get(id=line_id)
    except PlannerLine.DoesNotExist:
        return Response({"detail": "Line not found."}, status=404)
    return Response(assign_machines(line.line_no, stations))


@api_view(["GET"])
def available_machines_view(request):
    """GET /api/line-planner/available-machines/?line_id=&type=&exclude=1,2

    Machines of a type that can fill a station (for the change dropdown).
    """
    line_id = _i(request.query_params.get("line_id"))
    code = (request.query_params.get("type") or "").strip()
    if not line_id or not code:
        return Response({"detail": "line_id and type are required."}, status=400)
    try:
        line = PlannerLine.objects.get(id=line_id)
    except PlannerLine.DoesNotExist:
        return Response({"detail": "Line not found."}, status=404)
    exclude = [i for i in (_i(x) for x in (request.query_params.get("exclude") or "").split(",")) if i]
    return Response(available_machines(line.line_no, code, exclude_ids=exclude))


@api_view(["POST"])
def save_view(request):
    """POST /api/line-planner/save/

    Body: {style_id, line_id, inputs, summary, stations}. Saves a new version.
    """
    d = request.data or {}
    style_id = _i(d.get("style_id"))
    line_id = _i(d.get("line_id"))
    stations = d.get("stations")
    if not style_id or not line_id or not isinstance(stations, list):
        return Response({"detail": "style_id, line_id and stations[] are required."}, status=400)
    try:
        layout = services.save_layout(
            style_id, line_id, d.get("inputs") or {}, d.get("summary") or {}, stations
        )
    except (Style.DoesNotExist, PlannerLine.DoesNotExist):
        return Response({"detail": "Style or line not found."}, status=404)
    return Response(LayoutSerializer(layout).data, status=201)
