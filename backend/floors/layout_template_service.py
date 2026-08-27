"""Enrich floors_linelayouttemplate rows with HR and floor/line names."""

from __future__ import annotations

from typing import Any

from django.db import connections
from django.db.models import Q

from floors.models import Line, LineLayoutTemplate
from mbm_automation.hr_lookup import HR_DB, _designation_name, build_hr_photo_url, lookup_hr_profile
from mbm_automation.hr_models import HrAsBasicInfo


def line_names_by_floor(floor_ids: set[int]) -> dict[tuple[int, int], str]:
    if not floor_ids:
        return {}
    mapping: dict[tuple[int, int], str] = {}
    for row in Line.objects.filter(floor_id__in=floor_ids).only("floor_id", "line_number", "name"):
        mapping[(row.floor_id, row.line_number)] = row.name
    return mapping


def bulk_hr_by_employee_ids(employee_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Map employee id (user_id column) → name, designation from hr_as_basic_info."""
    ids = {str(x).strip() for x in employee_ids if x and str(x).strip()}
    if not ids or HR_DB not in connections:
        return {}

    try:
        qs = HrAsBasicInfo.objects.using(HR_DB).filter(deleted_at__isnull=True)
    except Exception:
        return {}
    q = Q()
    for uid in ids:
        q |= Q(temp_id=uid) | Q(associate_id=uid) | Q(as_rfid_code=uid) | Q(as_rfid_code__startswith=uid)
    try:
        rows = qs.filter(q).only(
            "as_name",
            "as_pic",
            "associate_id",
            "temp_id",
            "as_rfid_code",
            "as_designation_id",
            "worker_id",
        )
    except Exception:
        return {}

    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        profile = {
            "employee_name": (row.as_name or "").strip() or "—",
            "designation": _designation_name(row.as_designation_id),
            "operator_photo_url": build_hr_photo_url(row.as_pic),
        }
        for key in (row.temp_id, row.associate_id, row.as_rfid_code):
            if key:
                result[key.strip()] = profile

    for uid in ids:
        if uid in result:
            continue
        profile = lookup_hr_profile(uid)
        if profile:
            result[uid] = {
                "employee_name": profile.get("operator_name", "—"),
                "designation": profile.get("operator_designation", "—"),
                "operator_photo_url": profile.get("operator_photo_url"),
            }
    return result


def serialize_layout_template(obj: LineLayoutTemplate, hr_map: dict | None = None, line_map: dict | None = None) -> dict[str, Any]:
    hr_map = hr_map or {}
    line_map = line_map or {}
    emp_id = (obj.employee_id or "").strip()
    hr = hr_map.get(emp_id, {})
    if emp_id and not hr.get("employee_name"):
        profile = lookup_hr_profile(emp_id)
        if profile:
            hr = {
                "employee_name": profile.get("operator_name", "—"),
                "designation": profile.get("operator_designation", "—"),
                "operator_photo_url": profile.get("operator_photo_url"),
            }
    floor_id = obj.floor_id
    line_key = (floor_id, obj.line_id) if floor_id else None
    line_name = line_map.get(line_key, "—") if line_key else "—"
    stations = obj.stations or []
    process_count = len(stations) if obj.layout_type == LineLayoutTemplate.LayoutType.FINISHING else 0
    station_total = (
        sum(int(p.get("station_count") or p.get("stationCount") or 0) for p in stations)
        if obj.layout_type == LineLayoutTemplate.LayoutType.FINISHING
        else len(stations)
    )

    return {
        "id": obj.id,
        "employee_id": emp_id,
        "employee_name": hr.get("employee_name", "—"),
        "designation": hr.get("designation", "—"),
        "layout_name": obj.get_layout_type_display() or obj.layout_type or "—",
        "layout_type": obj.layout_type,
        "process_name": (obj.process_name or "").strip() or "—",
        "floor": floor_id,
        "floor_name": obj.floor.name if obj.floor_id and obj.floor else "—",
        "line_id": obj.line_id,
        "line_name": line_name,
        "station_id": obj.stations_id,
        "status": obj.status,
        "stations": stations,
        "process_count": process_count,
        "station_total": station_total,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
    }


def serialize_layout_template_list(queryset) -> list[dict[str, Any]]:
    items = list(queryset.select_related("floor"))
    floor_ids = {o.floor_id for o in items if o.floor_id}
    line_map = line_names_by_floor(floor_ids)
    hr_map = bulk_hr_by_employee_ids([o.employee_id for o in items])
    return [serialize_layout_template(obj, hr_map, line_map) for obj in items]
