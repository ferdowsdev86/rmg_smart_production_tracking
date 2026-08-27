"""CRUD API for machin_library (machine master list)."""

from django.db.models import Q
from rest_framework import viewsets
from rest_framework.response import Response

from floors.machin_library_serializers import MachinLibrarySerializer
from floors.models import MachinLibrary
from mbm_automation.models import LineLayout

SORT_FIELDS = {
    "machin_no": "machin_no",
    "machin_name": "machin_name",
    "brand": "brand",
    "model_no": "model_no",
    "floor": "floor",
    "line": "line",
    "line_no": "line",
    "unit": "unit",
    "owner": "owner",
    "is_active": "is_active",
    "movement_date": "movement_date",
    "supplier_name": "supplier_name",
    "created_at": "created_at",
}


def _line_map_for(machin_nos) -> dict[int, int]:
    if not machin_nos:
        return {}
    return {
        int(r["machin_no"]): int(r["line_no"])
        for r in LineLayout.objects.filter(machin_no__in=machin_nos).values(
            "machin_no", "line_no"
        )
    }


class MachinLibraryViewSet(viewsets.ModelViewSet):
    """List / create / retrieve / update / delete machine library entries."""

    serializer_class = MachinLibrarySerializer
    queryset = MachinLibrary.objects.all().order_by("machin_no")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(machin_name__icontains=search)
                | Q(brand__icontains=search)
                | Q(model_no__icontains=search)
                | Q(supplier_name__icontains=search)
            )

        for param, field in (
            ("machin_no", "machin_no"),
            ("machin_name", "machin_name"),
            ("brand", "brand"),
            ("model_no", "model_no"),
            ("floor", "floor"),
            ("line", "line"),
            ("unit", "unit"),
            ("owner", "owner"),
            ("supplier_name", "supplier_name"),
        ):
            val = (params.get(param) or "").strip()
            if not val:
                continue
            if field in ("machin_name", "brand", "model_no", "supplier_name"):
                qs = qs.filter(**{f"{field}__icontains": val})
            else:
                try:
                    qs = qs.filter(**{field: int(val)})
                except (TypeError, ValueError):
                    pass

        is_active = params.get("is_active")
        if is_active not in (None, ""):
            val = str(is_active).lower()
            if val in ("1", "active", "true", "yes"):
                qs = qs.filter(is_active=MachinLibrary.STATUS_ACTIVE)
            elif val in ("2", "inactive", "false", "no"):
                qs = qs.filter(is_active=MachinLibrary.STATUS_INACTIVE)

        ordering = (params.get("ordering") or "machin_no").strip()
        desc = ordering.startswith("-")
        key = ordering.lstrip("-")
        if key in SORT_FIELDS:
            qs = qs.order_by(("-" if desc else "") + SORT_FIELDS[key])

        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["line_map"] = getattr(self, "_line_map", {})
        return ctx

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        rows = list(queryset)
        self._line_map = _line_map_for([r.machin_no for r in rows])
        serializer = self.get_serializer(rows, many=True)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        self._line_map = _line_map_for([instance.machin_no])
        serializer = self.get_serializer(instance)
        return Response(serializer.data)
