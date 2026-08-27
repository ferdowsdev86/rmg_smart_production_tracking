"""API views for line layout master/detail CRUD."""

from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from employees.hr_employee import find_hr_row, list_hr_employees
from floors.line_layout_serializers import (
    FinishingProcessLineSerializer,
    LineLayoutMasterSerializer,
    LineLayoutMasterWriteSerializer,
)
from floors.line_layout_workstation import (
    list_process_assignments,
    save_process_assignments,
)
from floors.models import (
    FinishingProcess,
    Floor,
    LineLayoutTemplateDetail,
    LineLayoutTemplateDetailWorkstation,
    LineLayoutTemplateMaster,
)

# Form dropdown options (extend when ERP unit/style tables are wired).
LINE_LAYOUT_UNITS = [
    {"value": "1", "label": "Unit 1"},
    {"value": "2", "label": "Unit 2"},
    {"value": "3", "label": "Unit 3"},
]
LINE_LAYOUT_STYLES = ["Regular", "Slim", "Relaxed"]
PRODUCT_LABELS = {
    "shart": "Shirt",
    "pant": "Pant",
    "jacket": "Jacket",
}


class LineLayoutFormOptionsView(APIView):
    """Unit, style, product lists + floors/lines for line layout form."""

    def get(self, request):
        product_types = list(
            FinishingProcess.objects.filter(is_active=True)
            .exclude(product_type="")
            .values_list("product_type", flat=True)
            .distinct()
            .order_by("product_type")
        )
        products = [
            {
                "value": pt,
                "label": PRODUCT_LABELS.get(pt, pt.replace("_", " ").title()),
                "product_type": pt,
            }
            for pt in product_types
        ]
        floors = list(Floor.objects.all().order_by("name").values("id", "name"))
        return Response(
            {
                "units": LINE_LAYOUT_UNITS,
                "styles": LINE_LAYOUT_STYLES,
                "products": products,
                "product_types": product_types,
                "floors": floors,
            }
        )


class FinishingProcessByProductTypeView(APIView):
    """finishing_process where is_active=1, filtered by product_type."""

    def get(self, request):
        product_type = (request.query_params.get("product_type") or "").strip()
        qs = FinishingProcess.objects.filter(is_active=True).order_by("display_order")
        if product_type:
            qs = qs.filter(product_type=product_type)
        return Response(FinishingProcessLineSerializer(qs, many=True).data)


class LineLayoutProcessAssignmentView(APIView):
    """
    GET/POST /api/floors/line-layouts/<layout_id>/process-assignments/?process_id=
    Save rows to linelayouttemplate_detail_workstation.
    """

    def get(self, request, layout_id: int):
        process_id = request.query_params.get("process_id")
        if not process_id:
            return Response({"detail": "process_id is required."}, status=400)
        get_object_or_404(LineLayoutTemplateMaster, pk=layout_id)
        assignments = list_process_assignments(
            layout_id=layout_id,
            process_id=int(process_id),
        )
        enriched = []
        for row in assignments:
            hr = find_hr_row(row["employee_id"])
            employee_name = (hr.as_name or "").strip() if hr else row["employee_id"]
            enriched.append({**row, "employee_name": employee_name or row["employee_id"]})
        return Response(
            {
                "assignments": enriched,
                "employee_ids": [row["employee_id"] for row in enriched],
            }
        )

    def post(self, request, layout_id: int):
        process_id = request.data.get("process_id")
        employee_ids = request.data.get("employee_ids") or []
        if process_id is None:
            return Response({"detail": "process_id is required."}, status=400)
        if not isinstance(employee_ids, list):
            return Response({"detail": "employee_ids must be a list."}, status=400)

        get_object_or_404(LineLayoutTemplateMaster, pk=layout_id)
        try:
            assignments = save_process_assignments(
                layout_id=layout_id,
                process_id=int(process_id),
                employee_ids=[str(x) for x in employee_ids],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        return Response(
            {
                "assignments": assignments,
                "employee_ids": [row["employee_id"] for row in assignments],
                "assigned_count": len(assignments),
            }
        )


class LineLayoutProcessAssignmentEmployeesView(APIView):
    """GET /api/floors/line-layouts/process-assignment-employees/?search="""

    def get(self, request):
        search = request.query_params.get("search", "")
        try:
            limit = min(int(request.query_params.get("limit", 200)), 500)
        except (TypeError, ValueError):
            limit = 200
        return Response({"results": list_hr_employees(search=search, limit=limit)})


class LineLayoutMasterViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = LineLayoutTemplateMaster.objects.select_related("floor", "line").prefetch_related(
        Prefetch("details", queryset=LineLayoutTemplateDetail.objects.order_by("display_order"))
    )

    def perform_destroy(self, instance):
        LineLayoutTemplateDetailWorkstation.objects.filter(layout_id=instance.id).delete()
        instance.delete()

    def get_queryset(self):
        qs = super().get_queryset()
        product_type = self.request.query_params.get("product_type")
        if product_type:
            qs = qs.filter(product_type=product_type)
        floor_id = self.request.query_params.get("floor")
        if floor_id:
            qs = qs.filter(floor_id=int(floor_id))
        return qs.order_by("-layout_date", "-id")

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return LineLayoutMasterWriteSerializer
        return LineLayoutMasterSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(
            LineLayoutTemplateMaster.objects.select_related("floor", "line")
            .prefetch_related("details")
            .order_by("-layout_date", "-id")
        )
        serializer = LineLayoutMasterSerializer(queryset, many=True)
        return Response(serializer.data)
