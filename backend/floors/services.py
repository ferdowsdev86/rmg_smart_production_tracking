"""Aggregations for dashboard, lines, and reporting."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from django.db.models import Q, Sum
from django.utils import timezone

from attendance.models import CameraDetectionLog
from employees.hr_employee import hr_profile_for_associate_id
from floors.models import Floor, Line, LineLayoutTemplateDetailWorkstation, LineLayoutTemplateMaster, ProductionEntry


def _assigned_employee_count(*, on_date: date, line_id: int | None = None) -> int:
    layout_qs = LineLayoutTemplateMaster.objects.filter(layout_date=on_date)
    if line_id is not None:
        layout_qs = layout_qs.filter(line_id=line_id)
    layout_ids = list(layout_qs.values_list("id", flat=True))
    if not layout_ids:
        return 0
    qs = LineLayoutTemplateDetailWorkstation.objects.filter(layout_id__in=layout_ids).exclude(
        employee_id=""
    )
    return qs.values("employee_id").distinct().count()


def _today() -> date:
    return timezone.localdate()


def get_today() -> date:
    return _today()


def _line_actual(line: Line, on_date: date) -> int:
    agg = ProductionEntry.objects.filter(line=line, date=on_date).aggregate(total=Sum("quantity"))
    return int(agg["total"] or 0)


def _line_has_recent_mismatch(line: Line, since: datetime) -> bool:
    return CameraDetectionLog.objects.filter(
        is_mismatch=True,
        timestamp__gte=since,
        assigned_station__line=line,
    ).exists()


def line_status(line: Line, actual_today: int) -> str:
    """running | idle | problem"""
    if _line_has_recent_mismatch(line, timezone.now() - timedelta(hours=2)):
        return "problem"
    if actual_today > 0:
        return "running"
    return "idle"


def efficiency_pct(actual: int, target: int) -> float:
    if target <= 0:
        return 0.0
    return round(100.0 * actual / target, 1)


def build_floor_dashboard_payload() -> dict[str, Any]:
    floor = Floor.objects.order_by("id").first()
    if not floor:
        return {
            "floor": None,
            "generated_at": timezone.now().isoformat(),
            "kpis": {
                "employees_today": 0,
                "floor_efficiency_pct": 0.0,
                "total_output_today": 0,
                "lines_running": 0,
                "lines_total": 0,
                "trends": {
                    "employees_pct": 0.0,
                    "efficiency_pct": 0.0,
                    "output_pct": 0.0,
                    "lines_running_pct": 0.0,
                },
            },
            "lines": [],
        }

    today = _today()
    yesterday = today - timedelta(days=1)

    lines = list(Line.objects.filter(floor=floor).order_by("line_number"))
    line_payload: list[dict[str, Any]] = []

    total_target_today = 0
    total_actual_today = 0
    total_target_yesterday = 0
    total_actual_yesterday = 0

    employees_today = _assigned_employee_count(on_date=today)
    employees_yesterday = _assigned_employee_count(on_date=yesterday)

    lines_running = 0

    for line in lines:
        actual_today = _line_actual(line, today)
        target_today = line.daily_target
        actual_yesterday = _line_actual(line, yesterday)
        target_yesterday = line.daily_target

        total_target_today += target_today
        total_actual_today += actual_today
        total_target_yesterday += target_yesterday
        total_actual_yesterday += actual_yesterday

        eff = efficiency_pct(actual_today, target_today)
        status = line_status(line, actual_today)
        if status == "running":
            lines_running += 1

        emp_count = _assigned_employee_count(on_date=today, line_id=line.id)

        line_payload.append(
            {
                "id": line.id,
                "name": line.name,
                "line_number": line.line_number,
                "daily_target": target_today,
                "actual_today": actual_today,
                "efficiency_pct": eff,
                "employee_count": emp_count,
                "status": status,
                "is_active": line.is_active,
            }
        )

    floor_eff_today = efficiency_pct(total_actual_today, total_target_today)
    floor_eff_yesterday = efficiency_pct(total_actual_yesterday, total_target_yesterday)

    def trend(curr: float, prev: float) -> float:
        if prev <= 0:
            return 0.0 if curr <= 0 else 100.0
        return round(100.0 * (curr - prev) / prev, 1)

    lines_running_y = sum(
        1
        for line in lines
        if line_status(line, _line_actual(line, yesterday)) == "running"
    )

    return {
        "floor": {"id": floor.id, "name": floor.name, "total_lines": floor.total_lines},
        "generated_at": timezone.now().isoformat(),
        "kpis": {
            "employees_today": employees_today,
            "floor_efficiency_pct": floor_eff_today,
            "total_output_today": total_actual_today,
            "lines_running": lines_running,
            "lines_total": len(lines),
            "trends": {
                "employees_pct": trend(float(employees_today), float(employees_yesterday or 0)),
                "efficiency_pct": trend(floor_eff_today, floor_eff_yesterday),
                "output_pct": trend(float(total_actual_today), float(total_actual_yesterday or 0)),
                "lines_running_pct": trend(float(lines_running), float(lines_running_y or 0)),
            },
        },
        "lines": line_payload,
    }


def build_line_detail_payload(line_id: int) -> dict[str, Any] | None:
    try:
        line = Line.objects.select_related("floor").get(pk=line_id)
    except Line.DoesNotExist:
        return None

    today = _today()
    actual_today = _line_actual(line, today)
    target_today = line.daily_target
    eff = efficiency_pct(actual_today, target_today)
    emp_count = _assigned_employee_count(on_date=today, line_id=line.id)

    return {
        "line": {
            "id": line.id,
            "floor_id": line.floor_id,
            "name": line.name,
            "line_number": line.line_number,
            "daily_target": target_today,
            "actual_today": actual_today,
            "efficiency_pct": eff,
            "employee_count": emp_count,
            "status": line_status(line, actual_today),
            "is_active": line.is_active,
        },
        "generated_at": timezone.now().isoformat(),
    }


def hourly_for_line(line_id: int, on_date: date) -> list[dict[str, Any]]:
    rows = (
        ProductionEntry.objects.filter(line_id=line_id, date=on_date)
        .values("hour")
        .annotate(quantity=Sum("quantity"), target=Sum("target"))
        .order_by("hour")
    )
    by_hour = {r["hour"]: r for r in rows}
    out = []
    for h in range(24):
        r = by_hour.get(h, {"hour": h, "quantity": 0, "target": 0})
        qty = int(r["quantity"] or 0)
        tgt = int(r["target"] or 0)
        out.append(
            {
                "hour": h,
                "quantity": qty,
                "target": tgt,
                "below_target": tgt > 0 and qty < tgt,
            }
        )
    return out


def daily_lines_report(on_date: date, line_id: int | None) -> list[dict[str, Any]]:
    qs = Line.objects.select_related("floor").all()
    if line_id:
        qs = qs.filter(pk=line_id)
    result = []
    for line in qs.order_by("floor_id", "line_number"):
        actual = _line_actual(line, on_date)
        target = line.daily_target
        eff = efficiency_pct(actual, target)
        result.append(
            {
                "line_id": line.id,
                "line_name": line.name,
                "target": target,
                "actual": actual,
                "efficiency_pct": eff,
                "variance": actual - target,
            }
        )
    return result


def employee_efficiency_report(date_from: date, date_to: date, employee_id: str | None) -> list[dict[str, Any]]:
    return []


def mismatch_report(
    date_from: date,
    date_to: date,
    employee_id: str | None,
    line_id: int | None,
) -> list[dict[str, Any]]:
    qs = CameraDetectionLog.objects.select_related(
        "detected_station",
        "detected_station__line",
        "assigned_station",
        "assigned_station__line",
    ).filter(timestamp__date__gte=date_from, timestamp__date__lte=date_to)
    if employee_id:
        qs = qs.filter(employee_emp_id__iexact=employee_id.strip())
    if line_id:
        qs = qs.filter(Q(assigned_station__line_id=line_id) | Q(detected_station__line_id=line_id))

    logs = qs.order_by("-timestamp")
    out = []
    for log in logs:
        profile = hr_profile_for_associate_id(log.employee_emp_id)
        employee_name = profile.get("employee_name") if profile else log.employee_emp_id
        out.append(
            {
                "id": log.id,
                "time": log.timestamp.isoformat(),
                "employee_name": employee_name or "—",
                "emp_id": log.employee_emp_id,
                "assigned_station": (
                    f"{log.assigned_station.line.name} S{log.assigned_station.station_number}"
                ),
                "detected_station": (
                    f"{log.detected_station.line.name} S{log.detected_station.station_number}"
                ),
                "duration_seconds": None,
                "is_mismatch": log.is_mismatch,
                "confidence": log.confidence,
            }
        )
    return out
