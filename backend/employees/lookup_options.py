"""Value/label options for line & station autocomplete fields."""

from __future__ import annotations

from django.db.models import Q

from floors.models import Line, WorkStation


def list_line_options(*, search: str = "", limit: int = 100) -> list[dict]:
    qs = Line.objects.filter(is_active=True).order_by("floor_id", "line_number")
    term = (search or "").strip()
    if term:
        filters = Q(name__icontains=term)
        if term.isdigit():
            filters |= Q(line_number=int(term))
        qs = qs.filter(filters)
    return [
        {
            "value": row.id,
            "label": f"Line {row.line_number} — {row.name}",
            "line_number": row.line_number,
            "name": row.name,
        }
        for row in qs[:limit]
    ]


def list_station_options(*, line_id: int | None = None, search: str = "", limit: int = 100) -> list[dict]:
    qs = WorkStation.objects.order_by("line_id", "station_number")
    if line_id:
        qs = qs.filter(line_id=line_id)
    term = (search or "").strip()
    if term:
        filters = Q(operation_type__icontains=term)
        if term.isdigit():
            filters |= Q(station_number=int(term))
        qs = qs.filter(filters)
    return [
        {
            "value": row.station_number,
            "label": row.operation_type,
            "line": row.line_id,
            "station_number": row.station_number,
            "operation_type_id": row.operation_type,
            "station_id": row.id,
        }
        for row in qs.only("id", "line_id", "station_number", "operation_type")[:limit]
    ]


def resolve_line_option(line_id: int | str) -> dict | None:
    try:
        pk = int(line_id)
    except (TypeError, ValueError):
        return None
    row = Line.objects.filter(pk=pk).only("id", "line_number", "name").first()
    if not row:
        return None
    return {
        "value": row.id,
        "label": f"Line {row.line_number} — {row.name}",
        "line_number": row.line_number,
        "name": row.name,
    }


def resolve_station_option(*, line_id: int | str, station_number: int | str) -> dict | None:
    try:
        line_pk = int(line_id)
        station_no = int(station_number)
    except (TypeError, ValueError):
        return None
    row = (
        WorkStation.objects.filter(line_id=line_pk, station_number=station_no)
        .only("id", "line_id", "station_number", "operation_type")
        .first()
    )
    if not row:
        return None
    return {
        "value": row.station_number,
        "label": row.operation_type,
        "line": row.line_id,
        "station_number": row.station_number,
        "operation_type_id": row.operation_type,
        "station_id": row.id,
    }


def workstation_for_line_and_number(*, line_id: int, station_number: int) -> WorkStation | None:
    return WorkStation.objects.filter(line_id=line_id, station_number=station_number).first()
