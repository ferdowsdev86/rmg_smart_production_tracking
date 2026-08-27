from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from employees.hr_employee import list_hr_employees
from employees.lookup_options import (
    list_line_options,
    list_station_options,
    resolve_line_option,
    resolve_station_option,
)
from floors.models import LineLayoutTemplateMaster


class HrEmployeeListView(APIView):
    """GET /api/employees/hr-employees/?search= — list from cuttingedgedb.hr_as_basic_info."""

    def get(self, request):
        search = request.query_params.get("search", "")
        try:
            limit = min(int(request.query_params.get("limit", 100)), 500)
        except (TypeError, ValueError):
            limit = 100
        return Response({"results": list_hr_employees(search=search, limit=limit)})


class LineOptionListView(APIView):
    """GET /api/employees/lines/?search= — floors_line name + line_number."""

    def get(self, request):
        search = request.query_params.get("search", "")
        try:
            limit = min(int(request.query_params.get("limit", 100)), 500)
        except (TypeError, ValueError):
            limit = 100
        return Response({"results": list_line_options(search=search, limit=limit)})


class StationOptionListView(APIView):
    """GET /api/employees/stations/?line=&search= — floors_workstation station_number + operation_type."""

    def get(self, request):
        line_id = request.query_params.get("line")
        search = request.query_params.get("search", "")
        try:
            limit = min(int(request.query_params.get("limit", 100)), 500)
        except (TypeError, ValueError):
            limit = 100
        line_pk = int(line_id) if line_id else None
        return Response({"results": list_station_options(line_id=line_pk, search=search, limit=limit)})


class LineOptionDetailView(APIView):
    def get(self, request, pk):
        row = resolve_line_option(pk)
        if not row:
            return Response({"detail": "Not found."}, status=404)
        return Response(row)


class StationOptionLookupView(APIView):
    """GET /api/employees/stations/lookup/?line=&station_number="""

    def get(self, request):
        line_id = request.query_params.get("line")
        station_number = request.query_params.get("station_number")
        if not line_id or station_number is None:
            return Response({"detail": "line and station_number are required."}, status=400)
        row = resolve_station_option(line_id=line_id, station_number=station_number)
        if not row:
            return Response({"detail": "Not found."}, status=404)
        return Response(row)


class StationOptionDetailView(APIView):
    def get(self, request, pk):
        line_id = request.query_params.get("line")
        if not line_id:
            return Response({"detail": "line query param is required."}, status=400)
        row = resolve_station_option(line_id=line_id, station_number=pk)
        if not row:
            return Response({"detail": "Not found."}, status=404)
        return Response(row)


class LayoutOptionListView(APIView):
    """GET /api/employees/layouts/?assigned_date= — linelayouttemplate_master for assignment form."""

    def get(self, request):
        assigned_date = request.query_params.get("assigned_date")
        qs = LineLayoutTemplateMaster.objects.select_related("floor", "line").order_by(
            "-layout_date", "-id"
        )
        if assigned_date:
            qs = qs.filter(layout_date=assigned_date)
        try:
            limit = min(int(request.query_params.get("limit", 200)), 500)
        except (TypeError, ValueError):
            limit = 200
        results = []
        for master in qs[:limit]:
            results.append(
                {
                    "value": master.id,
                    "label": (
                        f"#{master.id} · {master.floor.name} · "
                        f"Line {master.line.line_number} · {master.layout_date}"
                    ),
                    "layour_id": master.id,
                    "floor_id": master.floor_id,
                    "floor_name": master.floor.name,
                    "line_id": master.line_id,
                    "line_number": master.line.line_number,
                    "line_name": master.line.name,
                    "layout_date": master.layout_date.isoformat(),
                    "product_type": master.product_type or "",
                }
            )
        return Response({"results": results})


class LayoutOptionDetailView(APIView):
    """GET /api/employees/layouts/<id>/ — floor, line, processes, workstations for a layout."""

    def get(self, request, pk):
        master = get_object_or_404(
            LineLayoutTemplateMaster.objects.select_related("floor", "line").prefetch_related(
                "details"
            ),
            pk=pk,
        )
        processes = [
            {
                "value": detail.finishing_process_id,
                "process_id": detail.finishing_process_id,
                "label": f"{detail.display_order}. {detail.process_name}",
                "process_name": detail.process_name,
                "display_order": detail.display_order,
            }
            for detail in master.details.all().order_by("display_order")
        ]
        stations = list_station_options(line_id=master.line_id, limit=500)
        return Response(
            {
                "layour_id": master.id,
                "floor_id": master.floor_id,
                "floor_name": master.floor.name,
                "line_id": master.line_id,
                "line_number": master.line.line_number,
                "line_name": master.line.name,
                "layout_date": master.layout_date.isoformat(),
                "product_type": master.product_type or "",
                "processes": processes,
                "stations": stations,
            }
        )
