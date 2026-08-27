"""CRUD API for machin_manpower_layout (machine + manpower per layout)."""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from employees.hr_employee import find_hr_row
from floors.line_layout_serializers import LineLayoutDetailSerializer, LineLayoutMasterSerializer
from floors.machin_manpower_serializers import (
    MachinManpowerLayoutSerializer,
    MachinManpowerLayoutWriteSerializer,
)
from floors.models import LineLayoutTemplateDetail, LineLayoutTemplateMaster, MachinManpowerLayout
from mbm_automation.models import LineLayout


class MachinManpowerLayoutFormContextView(APIView):
    """GET /api/floors/machin-manpower-layout/form-context/<layout_id>/"""

    def get(self, request, layout_id: int):
        master = get_object_or_404(
            LineLayoutTemplateMaster.objects.select_related("floor", "line"),
            pk=layout_id,
        )
        details = LineLayoutTemplateDetail.objects.filter(master_id=layout_id).order_by(
            "display_order", "id"
        )
        assignments = MachinManpowerLayout.objects.filter(layout_id=layout_id).order_by(
            "layouttemplete_id", "machin_no"
        )
        machines = list(
            LineLayout.objects.using("mbm_automation").all().order_by("floor", "line_no", "machin_no")
        )
        machine_options = [
            {
                "machin_no": row.machin_no,
                "machin_name": row.machin_name,
                "floor": row.floor,
                "line_no": row.line_no,
                "line_type": row.line_type,
                "label": f"#{row.machin_no} · {row.machin_name}",
            }
            for row in machines
        ]
        return Response(
            {
                "layout": LineLayoutMasterSerializer(master).data,
                "details": LineLayoutDetailSerializer(details, many=True).data,
                "assignments": MachinManpowerLayoutSerializer(assignments, many=True).data,
                "machines": machine_options,
            }
        )


class MachinManpowerLayoutBulkSaveView(APIView):
    """POST /api/floors/machin-manpower-layout/bulk-save/ — replace all rows for a layout."""

    def post(self, request):
        layout_id_raw = request.data.get("layout_id")
        if layout_id_raw is None:
            return Response({"detail": "layout_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            layout_id = int(layout_id_raw)
        except (TypeError, ValueError):
            return Response({"detail": "layout_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        if not LineLayoutTemplateMaster.objects.filter(pk=layout_id).exists():
            return Response({"detail": "Layout not found."}, status=status.HTTP_404_NOT_FOUND)

        assignments = request.data.get("assignments") or []
        if not isinstance(assignments, list):
            return Response({"detail": "assignments must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        MachinManpowerLayout.objects.filter(layout_id=layout_id).delete()

        created = []
        for row in assignments:
            if not row.get("machin_no") or not row.get("employee_id"):
                continue
            serializer = MachinManpowerLayoutWriteSerializer(
                data={
                    "layout_id": layout_id,
                    "layouttemplete_id": row.get("layouttemplete_id"),
                    "machin_no": row.get("machin_no"),
                    "employee_id": row.get("employee_id"),
                }
            )
            serializer.is_valid(raise_exception=True)
            created.append(serializer.create(serializer.validated_data))

        return Response(
            {
                "layout_id": layout_id,
                "count": len(created),
                "assignments": MachinManpowerLayoutSerializer(created, many=True).data,
            },
            status=status.HTTP_200_OK,
        )


class MachinManpowerLayoutViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = MachinManpowerLayout.objects.all().order_by("-id")

    def get_queryset(self):
        qs = super().get_queryset()
        layout_id = self.request.query_params.get("layout_id")
        if layout_id:
            qs = qs.filter(layout_id=int(layout_id))
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return MachinManpowerLayoutWriteSerializer
        return MachinManpowerLayoutSerializer

    def create(self, request, *args, **kwargs):
        serializer = MachinManpowerLayoutWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = serializer.save()
        return Response(
            MachinManpowerLayoutSerializer(row).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        payload = {
            "layout_id": request.data.get("layout_id", instance.layout_id),
            "layouttemplete_id": request.data.get("layouttemplete_id", instance.layouttemplete_id),
            "machin_no": request.data.get("machin_no", instance.machin_no),
            "employee_id": request.data.get("employee_id", instance.employee_id),
        }
        serializer = MachinManpowerLayoutWriteSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        master = serializer.validated_data["_master"]
        machine = serializer.validated_data["_machine"]
        from datetime import datetime

        assignment_date = timezone.make_aware(
            datetime.combine(master.layout_date, datetime.min.time())
        )
        instance.layout_id = int(payload["layout_id"])
        instance.layouttemplete_id = int(payload["layouttemplete_id"])
        instance.machin_no = int(payload["machin_no"])
        instance.employee_id = str(payload["employee_id"]).strip()
        instance.floor = int(machine.floor)
        instance.line_no = int(machine.line_no)
        instance.line_type = int(machine.line_type)
        instance.date = assignment_date
        instance.save()
        return Response(MachinManpowerLayoutSerializer(instance).data)
