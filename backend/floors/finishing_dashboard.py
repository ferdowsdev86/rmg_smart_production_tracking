"""Payload builder for /lines finishing dashboard (floors + finishing_process)."""

from __future__ import annotations

from datetime import date
from typing import Any

from django.shortcuts import get_object_or_404
from django.utils import timezone

from floors.event_metrics import (
    apply_workstation_events_to_sections,
    fetch_employee_metrics_by_employee,
    fetch_workstation_employees_by_workstation,
    fetch_workstation_present_employee_counts,
    fetch_workstation_present_employees_by_workstation,
    fetch_zone_present_summary,
    DEFAULT_ZONE_PRESENT_INTERVAL_SECONDS,
)
from floors.line_layout_workstation import workstation_offset_for_process
from employees.hr_employee import find_hr_row
from mbm_automation.hr_lookup import _designation_name
from floors.models import (
    FinishingProcess,
    Floor,
    Line,
    LineLayoutTemplateDetail,
    LineLayoutTemplateDetailWorkstation,
    LineLayoutTemplateMaster,
)
from floors.serializers import FinishingProcessSerializer, FloorSerializer, LineSerializer


def _empty_station_metrics() -> dict[str, Any]:
    return {
        "in_time": "—",
        "working_hour_display": "0h 0m",
        "non_productive_display": "0h 0m",
        "traffic_light_active": False,
        "workstation_problem": "INACTIVE",
        "event_count": 0,
        "has_day_activity": False,
        "assignment_match": False,
        "assignment_mismatch": False,
        "has_present_activity": False,
        "assigned_photo_url": None,
        "present_photo_url": None,
        "present_employee_id": None,
        "out_time": "—",
    }


def _station_display_label(*, employee_id: str | None) -> str:
    """Card label: associate ID from linelayouttemplate_detail_workstation."""
    return (employee_id or "").strip() or "—"


def _workstation_code_label(*, code: str, workstation_id: int) -> str:
    return f"{code}-{workstation_id:02d}"


def _build_station_slots(processes: list[dict]) -> list[dict[str, Any]]:
    """Fallback slots when no line layout template exists."""
    slots: list[dict[str, Any]] = []
    offset = 0
    for proc in processes:
        count = int(proc.get("stationCount") or 0)
        code = proc.get("code") or "ST"
        for i in range(1, count + 1):
            workstation_id = offset + i
            label = _workstation_code_label(code=code, workstation_id=workstation_id)
            slots.append(
                {
                    "slotId": f"{proc['id']}-{workstation_id}",
                    "slotIndex": len(slots) + 1,
                    "processId": proc["id"],
                    "finishingProcessId": proc.get("finishingProcessId"),
                    "processOrder": proc["order"],
                    "stationLabel": "—",
                    "workstationCode": label,
                    "workstationId": workstation_id,
                    "stationIndex": i,
                    "employeeId": None,
                    **_empty_station_metrics(),
                }
            )
        offset += count
    return slots


def _resolve_line_layout(*, floor_id: int, line_id: int) -> LineLayoutTemplateMaster | None:
    return (
        LineLayoutTemplateMaster.objects.filter(floor_id=floor_id, line_id=line_id)
        .order_by("-layout_date", "-id")
        .first()
    )


def _group_workstations_by_process(
    layout_id: int,
) -> dict[int, list[LineLayoutTemplateDetailWorkstation]]:
    grouped: dict[int, list[LineLayoutTemplateDetailWorkstation]] = {}
    rows = LineLayoutTemplateDetailWorkstation.objects.filter(layout_id=layout_id).order_by(
        "process_id", "workstation_id", "id"
    )
    for row in rows:
        grouped.setdefault(int(row.process_id), []).append(row)
    return grouped


def _employee_id_for_workstation(
    assignments: list[LineLayoutTemplateDetailWorkstation],
    *,
    workstation_id: int,
    slot_index: int,
) -> str | None:
    for row in assignments:
        if row.workstation_id == workstation_id:
            return (row.employee_id or "").strip() or None
    if 0 <= slot_index - 1 < len(assignments):
        return (assignments[slot_index - 1].employee_id or "").strip() or None
    return None


def _build_sections_for_layout(layout: LineLayoutTemplateMaster) -> tuple[list[dict], list[dict], int, int]:
    """Build process sections from linelayouttemplate_master + workstation assignments."""
    details = list(
        LineLayoutTemplateDetail.objects.filter(master_id=layout.id)
        .select_related("finishing_process")
        .order_by("display_order", "id")
    )
    ws_group = _group_workstations_by_process(layout.id)

    slots: list[dict[str, Any]] = []
    processes: list[dict[str, Any]] = []

    for detail in details:
        proc = detail.finishing_process
        count = int(detail.no_of_workstation or proc.station_count or 0)
        if count <= 0:
            continue

        proc_data = FinishingProcessSerializer(proc).data
        proc_data["stationCount"] = count
        proc_data["finishingProcessId"] = proc.pk
        processes.append(proc_data)

        code = proc.code or "ST"
        process_id = int(proc.pk)
        offset = workstation_offset_for_process(layout_id=layout.id, process_id=process_id)
        assignments = ws_group.get(process_id, [])

        for i in range(1, count + 1):
            workstation_id = offset + i
            employee_id = _employee_id_for_workstation(
                assignments,
                workstation_id=workstation_id,
                slot_index=i,
            )
            label = _station_display_label(employee_id=employee_id)
            code_label = _workstation_code_label(code=code, workstation_id=workstation_id)
            slots.append(
                {
                    "slotId": f"{proc_data['id']}-{workstation_id}",
                    "slotIndex": len(slots) + 1,
                    "processId": proc_data["id"],
                    "finishingProcessId": process_id,
                    "processOrder": proc.display_order,
                    "stationLabel": label,
                    "workstationCode": code_label,
                    "workstationId": workstation_id,
                    "stationIndex": i,
                    "employeeId": employee_id,
                    **_empty_station_metrics(),
                }
            )

    sections = [
        {
            "process": proc,
            "stations": [s for s in slots if s["processId"] == proc["id"]],
        }
        for proc in processes
    ]
    station_total = sum(int(p.get("stationCount") or 0) for p in processes)
    return processes, sections, len(processes), station_total


def _build_process_sections() -> tuple[list[dict], list[dict], int, int]:
    proc_qs = FinishingProcess.objects.filter(is_active=True).order_by("display_order")
    processes: list[dict] = []
    for proc in proc_qs:
        data = FinishingProcessSerializer(proc).data
        data["finishingProcessId"] = proc.pk
        processes.append(data)
    slots = _build_station_slots(processes)
    sections = [
        {
            "process": proc,
            "stations": [s for s in slots if s["processId"] == proc["id"]],
        }
        for proc in processes
    ]
    station_total = sum(int(p.get("stationCount") or 0) for p in processes)
    return processes, sections, len(processes), station_total


def _enrich_sections_with_hr(sections: list[dict]) -> None:
    """Store assigned employee HR profile (name/designation) from layout assignment."""
    for section in sections:
        for station in section.get("stations") or []:
            employee_id = (station.get("employeeId") or "").strip()
            if not employee_id:
                continue
            station["operator_id"] = employee_id
            station["assigned_employee_id"] = employee_id
            row = find_hr_row(employee_id)
            if row is None:
                station["assigned_operator_name"] = "—"
                station["operator_name"] = "—"
                station["operator_designation"] = "—"
                continue
            name = (row.as_name or "").strip() or "—"
            station["assigned_operator_name"] = name
            station["operator_name"] = name
            station["operator_designation"] = _designation_name(row.as_designation_id)


def _process_display_name(proc: dict[str, Any]) -> str:
    return (proc.get("name") or proc.get("process_name") or "Process").strip() or "Process"


def _floor_display_label(floor: Floor) -> str:
    name = (floor.name or "").strip()
    return f"Floor - {name}" if name else f"Floor - {floor.id}"


def build_line_summary(
    sections: list[dict[str, Any]],
    *,
    floor_label: str,
    line_label: str,
    present_counts: dict[str, int] | None = None,
    present_employees_by_ws: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    present_counts = present_counts or {}
    present_employees_by_ws = present_employees_by_ws or {}

    ws_info: dict[str, dict[str, Any]] = {}
    for section in sections:
        proc_name = _process_display_name(section.get("process") or {})
        for station in section.get("stations") or []:
            ws_key = str(station.get("workstationId") or "").strip()
            if not ws_key:
                continue
            ws_info[ws_key] = {
                "process_name": proc_name,
                "workstation_code": station.get("workstationCode") or ws_key,
                "workstation_id": station.get("workstationId"),
            }

    assigned_workers: list[dict[str, Any]] = []
    for section in sections:
        proc_name = _process_display_name(section.get("process") or {})
        for station in section.get("stations") or []:
            employee_id = (station.get("employeeId") or "").strip()
            if not employee_id:
                continue
            ws_key = str(station.get("workstationId") or "").strip()
            assigned_workers.append(
                {
                    "employee_id": employee_id,
                    "employee_name": (
                        station.get("assigned_operator_name") or station.get("operator_name") or "—"
                    ).strip()
                    or "—",
                    "floor_label": floor_label,
                    "line_label": line_label,
                    "process_name": proc_name,
                    "workstation_id": station.get("workstationId"),
                    "workstation_code": station.get("workstationCode") or ws_key or "—",
                    "multi_employee_station": present_counts.get(ws_key, 0) > 1,
                }
            )

    present_workers: list[dict[str, Any]] = []
    seen_present: set[tuple[str, str]] = set()
    for ws_key in sorted(ws_info.keys(), key=lambda value: int(value) if value.isdigit() else value):
        info = ws_info[ws_key]
        multi = present_counts.get(ws_key, 0) > 1
        for employee_id in present_employees_by_ws.get(ws_key, []):
            eid = (employee_id or "").strip()
            if not eid:
                continue
            dedupe_key = (ws_key, eid.upper())
            if dedupe_key in seen_present:
                continue
            seen_present.add(dedupe_key)
            row = find_hr_row(eid)
            name = (row.as_name or "").strip() if row else "—"
            present_workers.append(
                {
                    "employee_id": eid,
                    "employee_name": name or "—",
                    "floor_label": floor_label,
                    "line_label": line_label,
                    "process_name": info.get("process_name") or "—",
                    "workstation_id": info.get("workstation_id"),
                    "workstation_code": info.get("workstation_code") or ws_key,
                    "multi_employee_station": multi,
                }
            )

    assigned_workers.sort(
        key=lambda row: (row["process_name"], str(row["workstation_id"]), row["employee_id"])
    )
    present_workers.sort(
        key=lambda row: (row["process_name"], str(row["workstation_id"]), row["employee_id"])
    )

    return {
        "total_assigned_workers": len(assigned_workers),
        "total_present_workers": len(present_workers),
        "assigned_workers": assigned_workers,
        "present_workers": present_workers,
    }


def merge_line_summaries(summaries: list[dict[str, Any]]) -> dict[str, Any]:
    assigned_workers: list[dict[str, Any]] = []
    present_workers: list[dict[str, Any]] = []
    for summary in summaries:
        assigned_workers.extend(summary.get("assigned_workers") or [])
        present_workers.extend(summary.get("present_workers") or [])
    return {
        "total_assigned_workers": len(assigned_workers),
        "total_present_workers": len(present_workers),
        "assigned_workers": assigned_workers,
        "present_workers": present_workers,
    }


def _build_sections_for_line(
    *,
    floor_id: int,
    line_id: int,
    filter_date: date | None = None,
) -> tuple[list[dict], list[dict], int, int, int | None, dict[str, Any], list[dict[str, Any]]]:
    floor = Floor.objects.filter(pk=floor_id).first()
    line = Line.objects.filter(pk=line_id, floor_id=floor_id).first()
    floor_label = _floor_display_label(floor) if floor else f"Floor - {floor_id}"
    line_label = f"Line - {line.line_number}" if line else f"Line - {line_id}"

    layout = _resolve_line_layout(floor_id=floor_id, line_id=line_id)
    if layout is None:
        processes, sections, process_count, station_total = _build_process_sections()
        _enrich_sections_with_hr(sections)
        line_summary = build_line_summary(sections, floor_label=floor_label, line_label=line_label)
        return processes, sections, process_count, station_total, None, line_summary, []
    processes, sections, process_count, station_total = _build_sections_for_layout(layout)
    _enrich_sections_with_hr(sections)
    present_counts: dict[str, int] = {}
    present_employees_by_ws: dict[str, list[str]] = {}
    if filter_date is not None:
        present_counts = fetch_workstation_present_employee_counts(
            filter_date,
            floor_id=layout.floor_id,
            line_id=layout.line_id,
        )
        present_employees_by_ws = fetch_workstation_present_employees_by_workstation(
            filter_date,
            floor_id=layout.floor_id,
            line_id=layout.line_id,
        )
        apply_workstation_events_to_sections(
            sections,
            fetch_workstation_employees_by_workstation(
                filter_date,
                floor_id=layout.floor_id,
                line_id=layout.line_id,
            ),
            fetch_employee_metrics_by_employee(
                filter_date,
                floor_id=layout.floor_id,
                line_id=layout.line_id,
            ),
        )
    line_summary = build_line_summary(
        sections,
        floor_label=floor_label,
        line_label=line_label,
        present_counts=present_counts,
        present_employees_by_ws=present_employees_by_ws,
    )
    zone_present: list[dict[str, Any]] = []
    if filter_date is not None and layout is not None:
        zone_present = fetch_zone_present_summary(
            filter_date,
            floor_id=layout.floor_id,
            line_id=layout.line_id,
        )
    return processes, sections, process_count, station_total, layout.id, line_summary, zone_present


def _line_payload(line: Line) -> dict[str, Any]:
    return {
        **LineSerializer(line).data,
        "display_label": f"Line - {line.line_number}",
    }


def build_finishing_dashboard_payload(
    floor_id: int,
    line_id: int,
    *,
    filter_date: date | None = None,
) -> dict[str, Any]:
    floor = get_object_or_404(Floor, pk=floor_id)
    line = get_object_or_404(Line, pk=line_id, floor=floor)
    target_date = filter_date or timezone.localdate()
    processes, sections, process_count, station_total, layout_id, line_summary, zone_present = _build_sections_for_line(
        floor_id=floor_id,
        line_id=line_id,
        filter_date=target_date,
    )

    return {
        "view": "line",
        "title": "FINISHING-DASHBOARD",
        "generated_at": timezone.now().isoformat(),
        "filter_date": target_date.isoformat(),
        "layout_id": layout_id,
        "floor": {
            **FloorSerializer(floor).data,
            "display_label": f"Floor - {floor.id}",
        },
        "line": _line_payload(line),
        "lines": [],
        "line_dashboards": [],
        "process_count": process_count,
        "station_total": station_total,
        "line_summary": line_summary,
        "processes": processes,
        "sections": sections,
        "zone_present": zone_present,
        "zone_present_interval_seconds": DEFAULT_ZONE_PRESENT_INTERVAL_SECONDS,
    }


def build_floor_finishing_dashboard_payload(
    floor_id: int,
    *,
    filter_date: date | None = None,
) -> dict[str, Any]:
    """All lines on a floor — serial layout for initial /lines view."""
    floor = get_object_or_404(Floor, pk=floor_id)
    target_date = filter_date or timezone.localdate()
    line_qs = Line.objects.filter(floor=floor, is_active=True).order_by("line_number")
    if not line_qs.exists():
        line_qs = Line.objects.filter(floor=floor).order_by("line_number")

    line_dashboards = []
    floor_station_total = 0
    line_summaries: list[dict[str, Any]] = []
    reference_processes: list[dict] = []
    reference_sections: list[dict] = []
    reference_process_count = 0

    for line in line_qs:
        processes, sections, process_count, station_total, layout_id, line_summary, zone_present = _build_sections_for_line(
            floor_id=floor_id,
            line_id=line.id,
            filter_date=target_date,
        )
        floor_station_total += station_total
        line_summaries.append(line_summary)
        if not reference_processes:
            reference_processes = processes
            reference_sections = sections
            reference_process_count = process_count
        line_dashboards.append(
            {
                "line": _line_payload(line),
                "layout_id": layout_id,
                "process_count": process_count,
                "station_total": station_total,
                "line_summary": line_summary,
                "processes": processes,
                "sections": sections,
                "zone_present": zone_present,
            }
        )

    return {
        "view": "all",
        "title": "FINISHING-DASHBOARD",
        "generated_at": timezone.now().isoformat(),
        "filter_date": target_date.isoformat(),
        "floor": {
            **FloorSerializer(floor).data,
            "display_label": f"Floor - {floor.id}",
        },
        "line": None,
        "lines": [_line_payload(ln) for ln in line_qs],
        "line_dashboards": line_dashboards,
        "process_count": reference_process_count,
        "station_total": floor_station_total,
        "line_summary": merge_line_summaries(line_summaries),
        "processes": reference_processes,
        "sections": reference_sections,
    }


def default_floor_and_line() -> tuple[Floor | None, Line | None]:
    floor = Floor.objects.order_by("id").first()
    if not floor:
        return None, None
    line = Line.objects.filter(floor=floor, is_active=True).order_by("line_number").first()
    if not line:
        line = Line.objects.filter(floor=floor).order_by("line_number").first()
    return floor, line
