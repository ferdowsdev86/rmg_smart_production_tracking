"""Aggregate finishing floor metrics from smartfinishinfloor.camera_data by workstation."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.utils import timezone

from employees.hr_employee import find_hr_row
from floors.camera_zones import load_zone_camera_map
from floors.models import Line
from mbm_automation.hr_lookup import build_hr_photo_path, _designation_name

_CAMERA_DATA_TABLE = "camera_data"


def _parse_timestamp(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(raw[:26], fmt)
        except ValueError:
            continue
    return None


def _duration_hm_display(seconds: int) -> str:
    if seconds <= 0:
        return "0h 0m"
    hours, rem = divmod(int(seconds), 3600)
    minutes, _ = divmod(rem, 60)
    return f"{hours}h {minutes}m"


def _format_time_hm_from_timestamp(value: datetime | str | None) -> str:
    """Hour and minute from camera_data intime/outtime (no seconds)."""
    dt = _parse_timestamp(value)
    if dt is None:
        return "—"
    hour12 = dt.hour % 12 or 12
    suffix = "AM" if dt.hour < 12 else "PM"
    return f"{hour12}:{dt.minute:02d} {suffix}"


def _working_time_between(
    first_timestamp: datetime | str | None,
    last_timestamp: datetime | str | None,
) -> tuple[str, int]:
    """WT = elapsed time from first in to last out for one employee."""
    first = _parse_timestamp(first_timestamp)
    last = _parse_timestamp(last_timestamp)
    if first is None or last is None:
        return "0h 0m", 0
    seconds = max(0, int((last - first).total_seconds()))
    return _duration_hm_display(seconds), seconds


def _hr_profile_for_associate(associate_id: str | None) -> dict[str, Any]:
    uid = (associate_id or "").strip()
    if not uid:
        return {
            "employee_id": None,
            "operator_name": "—",
            "operator_designation": "—",
            "photo_url": None,
        }
    row = find_hr_row(uid)
    if row is None:
        return {
            "employee_id": uid,
            "operator_name": "—",
            "operator_designation": "—",
            "photo_url": None,
        }
    return {
        "employee_id": uid,
        "operator_name": (row.as_name or "").strip() or "—",
        "operator_designation": _designation_name(row.as_designation_id),
        "photo_url": build_hr_photo_path(row.as_pic),
    }


def _camera_floor_line_clause(
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> tuple[str, list[Any]]:
    """camera_data stores floor/line as strings (usually floor_id and line_number)."""
    sql = ""
    params: list[Any] = []
    if floor_id is not None:
        sql += " AND TRIM(floor) = %s"
        params.append(str(floor_id))
    if line_id is not None:
        line_values = {str(line_id)}
        line = Line.objects.filter(pk=line_id).values_list("line_number", flat=True).first()
        if line is not None:
            line_values.add(str(line))
        placeholders = ", ".join(["%s"] * len(line_values))
        sql += f" AND TRIM(line) IN ({placeholders})"
        params.extend(sorted(line_values))
    return sql, params


def _camera_data_base_where() -> str:
    return f"""
        FROM {_CAMERA_DATA_TABLE}
        WHERE workstation_id IS NOT NULL
          AND TRIM(workstation_id) != ''
          AND employee_id IS NOT NULL
          AND TRIM(employee_id) != ''
          AND UPPER(TRIM(employee_id)) NOT LIKE 'STARTUP%%'
          AND date = %s
    """


def _metrics_from_camera_row(
    event_employee_id: str,
    first_timestamp: Any,
    last_timestamp: Any,
    record_count: Any,
    *,
    has_open_session: bool = False,
) -> dict[str, Any]:
    wt_display, wt_seconds = _working_time_between(first_timestamp, last_timestamp)
    return {
        "event_employee_id": (event_employee_id or "").strip(),
        "in_time": _format_time_hm_from_timestamp(first_timestamp),
        "out_time": _format_time_hm_from_timestamp(last_timestamp),
        "first_created_at": str(first_timestamp or "").strip() or None,
        "last_created_at": str(last_timestamp or "").strip() or None,
        "working_hour_display": wt_display,
        "non_productive_display": "0h 0m",
        "working_seconds": wt_seconds,
        "active_seconds": wt_seconds,
        "idle_seconds": 0,
        "event_count": int(record_count or 0),
        "currently_present": bool(has_open_session),
    }


def _camera_data_metrics_sql(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> tuple[str, list[Any]]:
    floor_line_sql, floor_line_params = _camera_floor_line_clause(
        floor_id=floor_id,
        line_id=line_id,
    )
    sql = f"""
        SELECT
            TRIM(workstation_id) AS ws_id,
            TRIM(employee_id) AS event_employee_id,
            MIN(CASE WHEN intime IS NOT NULL THEN TIMESTAMP(date, intime) END) AS first_created_at,
            GREATEST(
                COALESCE(
                    MAX(CASE WHEN outtime IS NOT NULL THEN TIMESTAMP(date, outtime) END),
                    TIMESTAMP('1970-01-01', '00:00:00')
                ),
                COALESCE(
                    MAX(CASE WHEN intime IS NOT NULL THEN TIMESTAMP(date, intime) END),
                    TIMESTAMP('1970-01-01', '00:00:00')
                )
            ) AS last_created_at,
            COUNT(*) AS event_count,
            MAX(CASE WHEN outtime IS NULL THEN 1 ELSE 0 END) AS has_open_session
        {_camera_data_base_where()}
        {floor_line_sql}
        GROUP BY TRIM(workstation_id), TRIM(employee_id)
    """
    params: list[Any] = [filter_date.isoformat(), *floor_line_params]
    return sql, params


def fetch_workstation_employees_by_workstation(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """All employees with camera_data rows per workstation on the selected date."""
    sql, params = _camera_data_metrics_sql(filter_date, floor_id=floor_id, line_id=line_id)
    grouped: dict[str, list[dict[str, Any]]] = {}
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        for (
            ws_id,
            event_employee_id,
            first_created_at,
            last_created_at,
            event_count,
            has_open_session,
        ) in cursor.fetchall():
            key = str(ws_id or "").strip()
            eid = (event_employee_id or "").strip()
            if not key or not eid:
                continue
            grouped.setdefault(key, []).append(
                _metrics_from_camera_row(
                    eid,
                    first_created_at,
                    last_created_at,
                    event_count,
                    has_open_session=bool(has_open_session),
                )
            )
    for employees in grouped.values():
        employees.sort(key=lambda item: (-int(item.get("event_count") or 0), item.get("event_employee_id") or ""))
    return grouped


def fetch_workstation_event_metrics(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> dict[str, dict[str, Any]]:
    """Primary employee (most camera rows) per workstation."""
    grouped = fetch_workstation_employees_by_workstation(
        filter_date,
        floor_id=floor_id,
        line_id=line_id,
    )
    return {ws_id: employees[0] for ws_id, employees in grouped.items() if employees}


def _camera_data_employee_metrics_sql(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> tuple[str, list[Any]]:
    floor_line_sql, floor_line_params = _camera_floor_line_clause(
        floor_id=floor_id,
        line_id=line_id,
    )
    sql = f"""
        SELECT
            TRIM(employee_id) AS event_employee_id,
            MIN(CASE WHEN intime IS NOT NULL THEN TIMESTAMP(date, intime) END) AS first_created_at,
            GREATEST(
                COALESCE(
                    MAX(CASE WHEN outtime IS NOT NULL THEN TIMESTAMP(date, outtime) END),
                    TIMESTAMP('1970-01-01', '00:00:00')
                ),
                COALESCE(
                    MAX(CASE WHEN intime IS NOT NULL THEN TIMESTAMP(date, intime) END),
                    TIMESTAMP('1970-01-01', '00:00:00')
                )
            ) AS last_created_at,
            COUNT(*) AS event_count,
            MAX(CASE WHEN outtime IS NULL THEN 1 ELSE 0 END) AS has_open_session
        {_camera_data_base_where()}
        {floor_line_sql}
        GROUP BY TRIM(employee_id)
    """
    params: list[Any] = [filter_date.isoformat(), *floor_line_params]
    return sql, params


def fetch_employee_metrics_by_employee(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> dict[str, dict[str, Any]]:
    """Camera in/out metrics for the whole line aggregated per employee (keyed UPPER(employee_id)).

    Used as a fallback when the edge camera reports all activity under one
    workstation_id, so a station can still show its assigned employee's time.
    """
    sql, params = _camera_data_employee_metrics_sql(filter_date, floor_id=floor_id, line_id=line_id)
    result: dict[str, dict[str, Any]] = {}
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        for (
            event_employee_id,
            first_created_at,
            last_created_at,
            event_count,
            has_open_session,
        ) in cursor.fetchall():
            eid = (event_employee_id or "").strip()
            if not eid:
                continue
            result[eid.upper()] = _metrics_from_camera_row(
                eid,
                first_created_at,
                last_created_at,
                event_count,
                has_open_session=bool(has_open_session),
            )
    return result


def fetch_workstation_present_employee_counts(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> dict[str, int]:
    """Distinct employees with camera_data per workstation on the selected date."""
    floor_line_sql, floor_line_params = _camera_floor_line_clause(
        floor_id=floor_id,
        line_id=line_id,
    )
    sql = f"""
        SELECT
            TRIM(workstation_id) AS ws_id,
            COUNT(DISTINCT TRIM(employee_id)) AS employee_count
        {_camera_data_base_where()}
        {floor_line_sql}
        GROUP BY TRIM(workstation_id)
    """
    params: list[Any] = [filter_date.isoformat(), *floor_line_params]

    counts: dict[str, int] = {}
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        for ws_id, employee_count in cursor.fetchall():
            key = str(ws_id or "").strip()
            if not key:
                continue
            counts[key] = int(employee_count or 0)
    return counts


def fetch_workstation_present_employees_by_workstation(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
) -> dict[str, list[str]]:
    """Distinct employee IDs with camera_data per workstation on the selected date."""
    floor_line_sql, floor_line_params = _camera_floor_line_clause(
        floor_id=floor_id,
        line_id=line_id,
    )
    sql = f"""
        SELECT
            TRIM(workstation_id) AS ws_id,
            TRIM(employee_id) AS employee_id
        {_camera_data_base_where()}
        {floor_line_sql}
        GROUP BY TRIM(workstation_id), TRIM(employee_id)
        ORDER BY TRIM(workstation_id), TRIM(employee_id)
    """
    params: list[Any] = [filter_date.isoformat(), *floor_line_params]

    grouped: dict[str, list[str]] = {}
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        for ws_id, employee_id in cursor.fetchall():
            key = str(ws_id or "").strip()
            eid = str(employee_id or "").strip()
            if not key or not eid:
                continue
            grouped.setdefault(key, []).append(eid)
    return grouped


def apply_workstation_events_to_sections(
    sections: list[dict[str, Any]],
    employees_by_workstation: dict[str, list[dict[str, Any]]],
    employee_metrics_by_employee: dict[str, dict[str, Any]] | None = None,
) -> None:
    """
    Layout assignment vs camera_data at workstation_id on selected floor/line/date.

    - assigned_* : from linelayouttemplate_detail_workstation (+ cross in UI if mismatch)
    - present_*  : employee with in/out time at this workstation from camera_data
    - present_employees : all employees with records at this workstation

    When a station has no camera rows matched by workstation_id but its assigned
    employee does have camera_data somewhere on the line (the edge camera may tag
    everyone under one workstation_id), the assigned employee's own in/out/working
    time is shown as a fallback via ``employee_metrics_by_employee``.
    """
    employee_metrics_by_employee = employee_metrics_by_employee or {}
    for section in sections:
        for station in section.get("stations") or []:
            assigned_id = (station.get("employeeId") or "").strip()
            ws_key = str(station.get("workstationId") or "").strip()
            station["assigned_employee_id"] = assigned_id or None

            assigned_profile = _hr_profile_for_associate(assigned_id)
            station["assigned_photo_url"] = assigned_profile["photo_url"]
            station["assigned_operator_name"] = assigned_profile["operator_name"]

            employees = employees_by_workstation.get(ws_key, []) if ws_key else []
            station["present_employees"] = []
            station["present_employee_id"] = None
            station["present_photo_url"] = None
            station["present_operator_name"] = "—"
            station["has_present_activity"] = False
            station["has_day_activity"] = False
            station["assignment_match"] = False
            station["assignment_mismatch"] = False
            station["multi_employee_station"] = False
            station["present_count"] = 0
            station["in_time"] = "—"
            station["out_time"] = "—"
            station["working_hour_display"] = "0h 0m"
            station["non_productive_display"] = "0h 0m"

            for employee_metrics in employees:
                event_employee_id = (employee_metrics.get("event_employee_id") or "").strip()
                if not event_employee_id:
                    continue
                present_profile = _hr_profile_for_associate(event_employee_id)
                match = bool(assigned_id) and assigned_id.upper() == event_employee_id.upper()
                station["present_employees"].append(
                    {
                        **employee_metrics,
                        "present_employee_id": event_employee_id,
                        "present_photo_url": present_profile["photo_url"],
                        "present_operator_name": present_profile["operator_name"],
                        "present_operator_designation": present_profile["operator_designation"],
                        "operator_designation": present_profile["operator_designation"],
                        "assigned_employee_id": assigned_id or None,
                        "assigned_photo_url": assigned_profile["photo_url"],
                        "assigned_operator_name": assigned_profile["operator_name"],
                        "assignment_match": match,
                        "assignment_mismatch": bool(assigned_id) and not match,
                        "has_present_activity": True,
                        "camera_at_workstation": True,
                        "currently_present": bool(employee_metrics.get("currently_present")),
                    }
                )

            present_count = len(station["present_employees"])
            station["present_count"] = present_count
            station["multi_employee_station"] = present_count > 1

            if present_count == 0:
                if not assigned_id:
                    continue
                # Fallback: match the assigned employee's own camera_data by id.
                fallback = employee_metrics_by_employee.get(assigned_id.upper())
                if not fallback:
                    station["assignment_mismatch"] = True
                    continue
                station.update(
                    {
                        key: fallback.get(key)
                        for key in (
                            "in_time",
                            "out_time",
                            "first_created_at",
                            "last_created_at",
                            "working_hour_display",
                            "non_productive_display",
                            "working_seconds",
                            "active_seconds",
                            "idle_seconds",
                            "event_count",
                        )
                    }
                )
                station["present_employee_id"] = assigned_id
                station["present_photo_url"] = assigned_profile["photo_url"]
                station["present_operator_name"] = assigned_profile["operator_name"]
                station["present_operator_designation"] = assigned_profile["operator_designation"]
                station["operator_designation"] = assigned_profile["operator_designation"]
                station["present_employees"] = [
                    {
                        **fallback,
                        "present_employee_id": assigned_id,
                        "present_photo_url": assigned_profile["photo_url"],
                        "present_operator_name": assigned_profile["operator_name"],
                        "present_operator_designation": assigned_profile["operator_designation"],
                        "assigned_employee_id": assigned_id,
                        "assignment_match": True,
                        "has_present_activity": True,
                        "camera_at_workstation": False,
                        "currently_present": bool(fallback.get("currently_present")),
                    }
                ]
                station["present_count"] = 1
                station["has_present_activity"] = True
                station["has_day_activity"] = True
                station["assignment_match"] = True
                station["assignment_mismatch"] = False
                continue

            primary = station["present_employees"][0]
            station.update(
                {
                    key: primary.get(key)
                    for key in (
                        "event_employee_id",
                        "in_time",
                        "out_time",
                        "first_created_at",
                        "last_created_at",
                        "working_hour_display",
                        "non_productive_display",
                        "working_seconds",
                        "active_seconds",
                        "idle_seconds",
                        "event_count",
                        "present_employee_id",
                        "present_photo_url",
                        "present_operator_name",
                        "present_operator_designation",
                        "operator_designation",
                    )
                }
            )
            station["has_present_activity"] = True
            station["has_day_activity"] = True

            if not assigned_id:
                continue

            station["assignment_match"] = any(
                item.get("assignment_match") for item in station["present_employees"]
            )
            station["assignment_mismatch"] = not station["assignment_match"]


DEFAULT_ZONE_PRESENT_INTERVAL_SECONDS = 300


def _factory_now() -> datetime:
    """Factory wall clock — camera_data intime/outtime are stored in this timezone."""
    tz = ZoneInfo(getattr(settings, "SEWING_LOG_TIMEZONE", "Asia/Dhaka"))
    return timezone.now().astimezone(tz)


def fetch_zone_present_counts(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
    interval_seconds: int = DEFAULT_ZONE_PRESENT_INTERVAL_SECONDS,
) -> dict[int, int]:
    """Distinct employees per zone from camera_data (by camera_id, not workstation_id)."""
    summary = fetch_zone_present_summary(
        filter_date,
        floor_id=floor_id,
        line_id=line_id,
        interval_seconds=interval_seconds,
    )
    return {item["zone"]: int(item["present"]) for item in summary}


def fetch_zone_present_summary(
    filter_date: date,
    *,
    floor_id: int | None = None,
    line_id: int | None = None,
    interval_seconds: int = DEFAULT_ZONE_PRESENT_INTERVAL_SECONDS,
) -> list[dict[str, Any]]:
    """Per-zone present headcount from camera_data keyed by camera_id.

    Ignores workstation_id. Merges duplicate employee_id rows — each person
    counted once per zone using their latest row (MAX id). Requires outtime IS
    NULL on that row and intime within the rolling interval (default 5 minutes).
    """
    floor_line_sql, floor_line_params = _camera_floor_line_clause(
        floor_id=floor_id,
        line_id=line_id,
    )
    window_start = _factory_now() - timedelta(seconds=max(0, interval_seconds))
    window_start_sql = window_start.strftime("%Y-%m-%d %H:%M:%S")

    summary: list[dict[str, Any]] = []
    for zone in load_zone_camera_map():
        zone_number = int(zone["zone"])
        camera_id = (zone.get("camera_id") or f"CAM-{zone_number:02d}").strip()
        station_ids = sorted(zone.get("station_ids") or set(), key=lambda value: (len(value), value))

        params: list[Any] = [
            filter_date.isoformat(),
            camera_id,
            *floor_line_params,
            window_start_sql,
        ]

        sql = f"""
            SELECT TRIM(cd.employee_id)
            FROM {_CAMERA_DATA_TABLE} cd
            INNER JOIN (
                SELECT TRIM(employee_id) AS emp, MAX(id) AS max_id
                {_camera_data_base_where()}
                  AND TRIM(camera_id) = %s
                {floor_line_sql}
                GROUP BY TRIM(employee_id)
            ) latest ON cd.id = latest.max_id
            WHERE cd.outtime IS NULL
              AND cd.intime IS NOT NULL
              AND TIMESTAMP(cd.date, cd.intime) >= %s
              AND cd.employee_id IS NOT NULL
              AND TRIM(cd.employee_id) != ''
              AND UPPER(TRIM(cd.employee_id)) NOT LIKE 'STARTUP%%'
            ORDER BY TRIM(cd.employee_id)
        """
        employee_ids: list[str] = []
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            employee_ids = [
                str(row[0]).strip()
                for row in cursor.fetchall()
                if row and row[0] and str(row[0]).strip()
            ]

        summary.append(
            {
                "zone": zone_number,
                "camera_id": camera_id,
                "present": len(employee_ids),
                "employee_ids": employee_ids,
                "station_ids": station_ids,
            }
        )

    return summary
