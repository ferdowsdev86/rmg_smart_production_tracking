from datetime import date
from typing import Optional

from django.db.models import OuterRef, Subquery
from django.utils import timezone

from mbm_automation.models import LineLayout, SewingLog
from mbm_automation.sewing_analysis import (
    _duration_hms_display,
    analyze_machin_logs,
    enrich_rfid_shift_times,
    lookup_daily_target,
    lookup_day_line_target,
    resolve_active_machin_user,
)
from mbm_automation.hr_lookup import lookup_hr_profile

LINE_TYPE_INPUT = 0
STANDARD_SHIFT_SECONDS = 8 * 3600  # 8h regular; above = OT
LINE_TYPE_WORK = 1
LINE_TYPE_OUTPUT = 2


def _station_role(line_type: int, *, is_first_work: bool = False, is_last_work: bool = False) -> str:
    if line_type == LINE_TYPE_INPUT:
        return "input"
    if line_type == LINE_TYPE_OUTPUT:
        return "output"
    return "work"


def _latest_log_subquery(field: str, on_date: Optional[date] = None):
    qs = SewingLog.objects.filter(machin_id=OuterRef("machin_no"))
    if on_date is not None:
        qs = qs.filter(logged_at__date=on_date)
    return Subquery(qs.order_by("-logged_at").values(field)[:1])


def list_sewing_lines():
    rows = LineLayout.objects.values("floor", "line_no").distinct().order_by("floor", "line_no")
    lines = []
    for row in rows:
        floor, line_no = row["floor"], row["line_no"]
        count = LineLayout.objects.filter(floor=floor, line_no=line_no).count()
        lines.append(
            {
                "floor": floor,
                "line_no": line_no,
                "label": f"Floor {floor} · Line {line_no}",
                "machine_count": count,
            }
        )
    return lines


def _build_rfid_station_data(
    machin_id: int,
    machin_user: str,
    on_date: date,
) -> Optional[dict]:
    """Shared RFID metrics (flag1/3/8/9 rules) for API + sewing line cards."""
    uid = (machin_user or "").strip()
    if not uid:
        return None
    if not SewingLog.objects.filter(
        machin_id=machin_id,
        machin_user=uid,
        logged_at__date=on_date,
    ).exists():
        return None

    analysis = analyze_machin_logs(
        machin_id,
        on_date=on_date,
        strict_day=True,
        machin_user=uid,
    )
    station = {
        **analysis,
        "machin_no": machin_id,
        "operator_id": uid,
        "flags": analysis.get("flags") or {},
    }
    return enrich_rfid_shift_times(machin_id, uid, on_date, station)


def _hr_identity_for_machin_user(machin_user: str) -> dict[str, str]:
    """Always resolve operator name + designation from HR for logged-in machin_user."""
    uid = (machin_user or "").strip()
    if not uid:
        return {"employee_name": "—", "designation": "—"}
    hr = lookup_hr_profile(uid)
    return {
        "employee_name": (hr.get("operator_name") if hr else None) or "—",
        "designation": (hr.get("operator_designation") if hr else None) or "—",
    }


def _minimal_rfid_response(machin_id: int, machin_user: str) -> dict:
    identity = _hr_identity_for_machin_user(machin_user)
    return {
        "machin_id": machin_id,
        "machin_user": machin_user,
        "employee_name": identity["employee_name"],
        "designation": identity["designation"],
        "present_status": "InActive",
        "in_time": "—",
        "wr": "—",
        "mrt": "0 sec",
        "npt": "0h 0m 0s",
        "defect": 0,
        "production": 0,
    }


def _dashboard_station_from_rfid(row, role: str, rfid_station: dict, *, filter_day: date) -> dict:
    """Map RFID station metrics onto sewing line card payload."""
    operator_id = (rfid_station.get("operator_id") or "").strip()
    hr = lookup_hr_profile(operator_id) if operator_id else None
    if hr:
        rfid_station = {
            **rfid_station,
            "operator_name": hr.get("operator_name") or rfid_station.get("operator_name"),
            "operator_designation": hr.get("operator_designation") or rfid_station.get("operator_designation"),
            "operator_photo_url": hr.get("operator_photo_url") or rfid_station.get("operator_photo_url"),
        }

    present_status = _rfid_present_status(rfid_station)
    present_active = present_status == "Active"
    total_sec = int(rfid_station.get("present_duration_seconds") or 0)
    problem = rfid_station.get("workstation_problem") or "GREEN"
    ot_sec = max(0, total_sec - STANDARD_SHIFT_SECONDS)

    return {
        "id": row.id,
        "role": role,
        "machin_no": row.machin_no,
        "machin_name": row.machin_name,
        "line_type": row.line_type,
        "operator_id": rfid_station.get("operator_id") or "",
        "daily_target": lookup_daily_target(row.machin_no, filter_day),
        "defect_total": int(rfid_station.get("defect_total") or 0),
        "prod_total": int(rfid_station.get("prod_total") or 0),
        "operator_name": rfid_station.get("operator_name") or "—",
        "operator_designation": rfid_station.get("operator_designation") or "—",
        "operator_photo_url": rfid_station.get("operator_photo_url"),
        "in_time": rfid_station.get("in_time") or "—",
        "start_time": rfid_station.get("start_time") or rfid_station.get("in_time") or "—",
        "break_time_display": rfid_station.get("break_time_display", "0h 0m 0s"),
        "out_time": rfid_station.get("out_time", "—"),
        "total_working_display": rfid_station.get("total_working_display")
        or _duration_hms_display(total_sec),
        "total_working_seconds": total_sec,
        "working_hour_display": _duration_hms_display(total_sec),
        "ot_seconds": ot_sec,
        "ot_hour_display": _duration_hms_display(ot_sec),
        "working_display": rfid_station.get("working_display") or "—",
        "machine_run_display": rfid_station.get("machine_run_display") or "—",
        "non_productive_display": rfid_station.get("non_productive_display") or "0h 0m 0s",
        "non_productive_seconds": int(rfid_station.get("non_productive_seconds") or 0),
        "present_status": present_status,
        "workstation_problem": problem if present_active else "INACTIVE",
        "traffic_light_active": present_active,
        "status": "present" if present_active else "offline",
        "operator_present": bool(rfid_station.get("operator_present")),
        "present_since": rfid_station.get("present_since"),
        "present_duration_label": rfid_station.get("present_duration_label") or "",
        "present_duration_seconds": total_sec,
        "runtime_total": int(rfid_station.get("runtime_total") or 0),
        "runtime_label": rfid_station.get("runtime_label") or "0",
        "has_problem": present_active and bool(rfid_station.get("has_problem")),
        "problem_total": int(rfid_station.get("problem_total") or 0),
        "problem_label": rfid_station.get("problem_label") or "",
        "flags": rfid_station.get("flags") or {},
        "last_logged_at": rfid_station.get("last_logged_at"),
        "virtual": False,
    }


def _dashboard_station_idle(row, role: str, *, filter_day: date) -> dict:
    """Machine on line layout with no operator currently logged in (latest flag3=0)."""
    return {
        "id": row.id,
        "role": role,
        "machin_no": row.machin_no,
        "machin_name": row.machin_name,
        "line_type": row.line_type,
        "operator_id": "",
        "daily_target": lookup_daily_target(row.machin_no, filter_day),
        "defect_total": 0,
        "prod_total": 0,
        "operator_name": "—",
        "operator_designation": "—",
        "operator_photo_url": None,
        "in_time": "—",
        "start_time": "—",
        "break_time_display": "0h 0m 0s",
        "out_time": "—",
        "total_working_display": "0h 0m 0s",
        "total_working_seconds": 0,
        "working_hour_display": "0h 0m 0s",
        "ot_seconds": 0,
        "ot_hour_display": "0h 0m 0s",
        "working_display": "—",
        "machine_run_display": "—",
        "non_productive_display": "0h 0m 0s",
        "non_productive_seconds": 0,
        "present_status": "InActive",
        "workstation_problem": "INACTIVE",
        "traffic_light_active": False,
        "status": "offline",
        "operator_present": False,
        "present_since": None,
        "present_duration_label": "",
        "present_duration_seconds": 0,
        "runtime_total": 0,
        "runtime_label": "0",
        "has_problem": False,
        "problem_total": 0,
        "problem_label": "",
        "flags": {"flag1": 0, "flag2": 0, "flag3": 0},
        "last_logged_at": None,
        "virtual": False,
    }


def build_sewing_line_dashboard(*, floor: int, line_no: int, on_date: Optional[date] = None) -> dict:
    qs = (
        LineLayout.objects.filter(floor=floor, line_no=line_no)
        .annotate(
            latest_user=_latest_log_subquery("machin_user", on_date),
            latest_logged_at=_latest_log_subquery("logged_at", on_date),
        )
        .order_by("line_type", "machin_no")
    )

    input_rows = [r for r in qs if r.line_type == LINE_TYPE_INPUT]
    output_rows = [r for r in qs if r.line_type == LINE_TYPE_OUTPUT]
    work_rows = [r for r in qs if r.line_type not in (LINE_TYPE_INPUT, LINE_TYPE_OUTPUT)]
    if not work_rows and qs.exists():
        work_rows = list(qs)

    def row_to_station(row, role: str) -> dict:
        filter_day = on_date or timezone.localdate()
        operator_id = resolve_active_machin_user(row.machin_no, filter_day)
        if not operator_id:
            return _dashboard_station_idle(row, role, filter_day=filter_day)

        rfid_station = _build_rfid_station_data(row.machin_no, operator_id, filter_day)
        if rfid_station is not None:
            return _dashboard_station_from_rfid(row, role, rfid_station, filter_day=filter_day)

        return _dashboard_station_idle(row, role, filter_day=filter_day)

    machines = [
        row_to_station(row, _station_role(row.line_type, is_first_work=i == 0, is_last_work=i == len(work_rows) - 1))
        for i, row in enumerate(work_rows)
    ]

    input_stations = [row_to_station(r, "input") for r in input_rows]
    output_stations = [row_to_station(r, "output") for r in output_rows]

    # The day's style + target for this line (day_line_target). Show all cards,
    # but only stamp style/target onto machines that actually have sewing_log
    # data for the date; the rest stay as-is.
    line_filter_day = on_date or timezone.localdate()
    line_style, line_target = lookup_day_line_target(floor, line_no, line_filter_day)
    present_ids = set(
        SewingLog.objects.filter(logged_at__date=line_filter_day)
        .exclude(machin_id__isnull=True)
        .values_list("machin_id", flat=True)
        .distinct()
    )
    for station in (*machines, *input_stations, *output_stations):
        if station.get("machin_no") in present_ids:
            station["style"] = line_style
            if line_target:
                station["daily_target"] = line_target

    if not input_stations:
        input_stations = [_virtual_station("input", floor, line_no)]
    if not output_stations:
        output_stations = [_virtual_station("output", floor, line_no)]

    present = sum(1 for m in machines if m.get("present_status") == "Active" or m["status"] == "present")
    running = sum(1 for m in machines if m["status"] == "running" or m["runtime_total"] > 0)
    problem = sum(1 for m in machines if m["status"] == "problem" or m["has_problem"])

    filter_date = on_date.isoformat() if on_date else timezone.localdate().isoformat()
    return {
        "floor": floor,
        "line_no": line_no,
        "line_label": f"Floor {floor} · Line {line_no}",
        "filter_date": filter_date,
        "generated_at": timezone.now().isoformat(),
        "source": "mbm_automation.line_layout + sewing_log",
        "style": line_style,
        "daily_target": line_target,
        "gsd": {
            "balance_pct": round((present / len(machines) * 100) if machines else 0, 1),
            "stations_total": len(machines),
            "present": present,
            "running": running,
            "problem": problem,
            "offline": sum(1 for m in machines if m["status"] == "offline"),
        },
        "input_stations": input_stations,
        "output_stations": output_stations,
        "machines": machines,
    }


def _rfid_present_status(station: dict) -> str:
    """Active / InActive from flag2=2 + flag3 rules (see rfid_present_status_from_logs)."""
    explicit = (station.get("present_status") or "").strip()
    if explicit in ("Active", "InActive"):
        return explicit

    if "latest_flag3" in station:
        flag3_vals = station.get("flag3_values")
        if isinstance(flag3_vals, list) and flag3_vals:
            if all(int(v or 0) == 0 for v in flag3_vals):
                return "InActive"
            if station.get("has_flag2_2") and all(int(v or 0) == 1 for v in flag3_vals):
                return "Active"
        return "Active" if int(station.get("latest_flag3") or 0) != 0 else "InActive"

    return "InActive"


def _station_to_rfid_record(station: dict) -> dict:
    machin_user = (station.get("operator_id") or "").strip()
    identity = _hr_identity_for_machin_user(machin_user)
    return {
        "machin_id": station.get("machin_no"),
        "machin_user": machin_user,
        "employee_name": identity["employee_name"],
        "designation": identity["designation"],
        "present_status": _rfid_present_status(station),
        "in_time": station.get("in_time") or "—",
        "wr": station.get("working_display") or "—",
        "mrt": station.get("machine_run_display") or "—",
        "npt": station.get("non_productive_display") or "0h 0m 0s",
        "defect": int(station.get("defect_total") or 0),
        "production": int(station.get("prod_total") or 0),
    }


def build_sewing_rfid_device_payload(
    *,
    machin_id: int,
    machin_user: str,
    on_date: date,
) -> Optional[dict]:
    """RFID device feed for one machine + operator on a login date."""
    station = _build_rfid_station_data(machin_id, machin_user, on_date)
    if station is None:
        return None
    return _station_to_rfid_record(station)


def _virtual_station(role: str, floor: int, line_no: int) -> dict:
    label = "Input buffer" if role == "input" else "Output / QC"
    return {
        "id": None,
        "role": role,
        "machin_no": None,
        "machin_name": label,
        "line_type": LINE_TYPE_INPUT if role == "input" else LINE_TYPE_OUTPUT,
        "operator_id": "",
        "daily_target": 0,
        "defect_total": 0,
        "prod_total": 0,
        "operator_name": "—",
        "operator_photo_url": None,
        "in_time": "—",
        "working_display": "—",
        "machine_run_display": "—",
        "workstation_problem": "—",
        "status": "ready",
        "operator_present": False,
        "present_duration_label": "",
        "runtime_total": 0,
        "runtime_label": "0",
        "has_problem": False,
        "problem_label": "",
        "flags": {"flag1": 0, "flag2": 0, "flag3": 0},
        "last_logged_at": None,
        "virtual": True,
    }
