"""Derive operator presence, runtime (flag1), and problems (flag2) from sewing_log."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from mbm_automation.hr_lookup import lookup_hr_profile
from mbm_automation.models import DailyTarget, SewingLog


def _factory_tz() -> ZoneInfo:
    return ZoneInfo(getattr(settings, "SEWING_LOG_TIMEZONE", "Asia/Dhaka"))


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _sewing_wall_datetime(dt: datetime | None) -> datetime | None:
    """Factory wall clock from DB (face value, not shifted to UTC)."""
    a = _aware(dt)
    if not a:
        return None
    return datetime(a.year, a.month, a.day, a.hour, a.minute, a.second, a.microsecond)


def _sewing_now_wall(now: datetime | None = None) -> datetime:
    instant = _aware(now) or timezone.now()
    local = instant.astimezone(_factory_tz())
    return datetime(
        local.year, local.month, local.day, local.hour, local.minute, local.second, local.microsecond
    )


def _duration_seconds(start: datetime | None, end: datetime | None) -> int:
    if not start or not end:
        return 0
    return int(max(0, (end - start).total_seconds()))


def _operator_display_name(machin_user: str, hr_cache: dict | None = None) -> str:
    uid = (machin_user or "").strip()
    if not uid:
        return "—"
    if hr_cache and uid in hr_cache:
        return hr_cache[uid].get("operator_name") or "—"
    hr = lookup_hr_profile(uid)
    if hr and hr.get("operator_name"):
        return hr["operator_name"]
    return "—"


def _operator_designation(machin_user: str, hr_cache: dict | None = None) -> str:
    uid = (machin_user or "").strip()
    if not uid:
        return "—"
    if hr_cache and uid in hr_cache:
        return hr_cache[uid].get("operator_designation") or "—"
    hr = lookup_hr_profile(uid)
    if hr and hr.get("operator_designation"):
        return hr["operator_designation"]
    return "—"


def _iso_to_local_ampm(iso_str: str | None) -> str:
    if not iso_str:
        return "—"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except ValueError:
        return "—"
    dt = _aware(dt)
    if not dt:
        return "—"
    local = timezone.localtime(dt)
    hour12 = local.hour % 12 or 12
    return f"{hour12}:{local.strftime('%M %p')}"


def _duration_hms_display(seconds: int) -> str:
    if seconds <= 0:
        return "0h 0m 0s"
    hours, rem = divmod(int(seconds), 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours}h {minutes}m {secs}s"


def _decimal_minutes_from_seconds(seconds: int) -> str:
    if seconds <= 0:
        return "0.00 Min"
    m = round(seconds / 60.0, 2)
    return f"{m:.2f} Min"


def _smart_duration_display(seconds: int) -> str:
    """Show seconds; at 60s use minutes; at 60m use hours."""
    total = int(seconds)
    if total <= 0:
        return "0 sec"
    if total < 60:
        return f"{total} sec"
    if total < 3600:
        minutes, secs = divmod(total, 60)
        if secs:
            return f"{minutes} min {secs} sec"
        return f"{minutes} min"
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    parts = [f"{hours} hr"]
    if minutes:
        parts.append(f"{minutes} min")
    if secs:
        parts.append(f"{secs} sec")
    return " ".join(parts)


def _machine_run_display(total_flag1: int) -> str:
    # Machine run = sum of flag1 for the operator (values are seconds).
    return _smart_duration_display(total_flag1)


def _non_productive_display(seconds: int) -> str:
    return _duration_hms_display(seconds)


def _working_display(seconds: int) -> str:
    return _duration_hms_display(seconds)


def _calculate_non_productive_seconds(
    logs: list,
    *,
    day: date,
    today: date,
    now: datetime,
) -> int:
    """
    Per machine / day: sum(flag3 logged_at − flag4 logged_at) for each NPT cycle.

    - flag4=1 starts non-productive time
    - next flag3=1 with a later logged_at on this machine ends that interval
    - Open flag4=1 without a later flag3=1 (today) runs until now
    """
    total = 0
    open_flag4_at: datetime | None = None

    for log in logs:
        f3 = int(log.flag3 or 0)
        f4 = int(log.flag4 or 0)
        at = _sewing_wall_datetime(log.logged_at)
        if not at:
            continue

        if f4 == 1:
            open_flag4_at = at
        if f3 == 1 and open_flag4_at is not None and at > open_flag4_at:
            total += _duration_seconds(open_flag4_at, at)
            open_flag4_at = None

    if open_flag4_at is not None:
        if day == today:
            end = _sewing_now_wall(now)
        else:
            end = _sewing_wall_datetime(logs[-1].logged_at) or open_flag4_at
        total += _duration_seconds(open_flag4_at, end)

    return total


def _workstation_problem_display(has_problem: bool) -> str:
    return "RED Light" if has_problem else "GREEN"


def _machine_traffic_light_active(logs: list) -> bool:
    """Active when selected day has in-time (all flags 0) or any user id on this machine."""
    for log in logs:
        if _is_present_punch(log):
            return True
        if _machin_user_id(log):
            return True
    return False


def _resolve_workstation_problem(logs: list) -> dict[str, Any]:
    """
    Per machine / day: latest flag2 or flag3 event wins.
    - flag2 > 0 → problem (RED Light)
    - flag3 > 0 → master card cleared (GREEN); overrides flag2 on the same row
    """
    state = "green"
    last_event_at = None
    last_flag2 = 0
    last_flag3 = 0

    for log in logs:
        f2 = log.flag2 or 0
        f3 = log.flag3 or 0
        if f3 > 0:
            state = "green"
            last_event_at = log.logged_at
            last_flag2 = f2
            last_flag3 = f3
        elif f2 > 0:
            state = "red"
            last_event_at = log.logged_at
            last_flag2 = f2
            last_flag3 = f3

    has_problem = state == "red"
    if has_problem:
        label = f"Workstation problem (flag2={last_flag2})"
    elif last_flag3 > 0:
        label = f"Master card cleared (flag3={last_flag3})"
    else:
        label = ""

    return {
        "has_problem": has_problem,
        "workstation_problem": _workstation_problem_display(has_problem),
        "problem_state": state,
        "problem_total": last_flag2 if has_problem else 0,
        "problem_label": label,
        "problem_event_at": last_event_at.isoformat() if last_event_at else None,
    }


def _format_duration(seconds: int) -> str:
    if seconds < 0:
        seconds = 0
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m"
    return f"{secs}s"


def _iso_to_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return _sewing_wall_datetime(datetime.fromisoformat(iso))
    except (TypeError, ValueError):
        return None


def _aggregate_shift_times(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    """Day totals from paired in/out punches: start, breaks between shifts, out, total working."""
    empty_shift = {
        "start_time": "—",
        "break_time_display": "0h 0m 0s",
        "out_time": "—",
        "total_working_display": "0h 0m 0s",
        "break_seconds": 0,
        "total_working_seconds": 0,
    }
    if not sessions:
        return empty_shift

    ordered = sorted(sessions, key=lambda s: s.get("present_since") or "")
    start_time = _iso_to_local_ampm(ordered[0].get("present_since"))
    last = ordered[-1]
    if last.get("open"):
        out_time = "—"
    elif last.get("present_until"):
        out_time = _iso_to_local_ampm(last.get("present_until"))
    else:
        out_time = "—"

    break_seconds = 0
    for i in range(len(ordered) - 1):
        end_dt = _iso_to_dt(ordered[i].get("present_until"))
        start_dt = _iso_to_dt(ordered[i + 1].get("present_since"))
        if end_dt and start_dt and start_dt > end_dt:
            break_seconds += _duration_seconds(end_dt, start_dt)

    total_working_seconds = sum(int(s.get("present_duration_seconds") or 0) for s in ordered)
    return {
        "start_time": start_time,
        "break_time_display": _duration_hms_display(break_seconds),
        "out_time": out_time,
        "total_working_display": _duration_hms_display(total_working_seconds),
        "break_seconds": break_seconds,
        "total_working_seconds": total_working_seconds,
    }


def _is_present_punch(log) -> bool:
    return (log.flag1 or 0) == 0 and (log.flag2 or 0) == 0 and (log.flag3 or 0) == 0


def _machin_user_id(log) -> str:
    return (log.machin_user or "").strip()


def _user_present_indexes(logs: list, user: str) -> list[int]:
    return [i for i, log in enumerate(logs) if _machin_user_id(log) == user and _is_present_punch(log)]


def _last_log_time_for_user(logs: list, user: str, after_i: int) -> datetime | None:
    last = None
    for j in range(after_i + 1, len(logs)):
        if _machin_user_id(logs[j]) != user:
            continue
        t = _aware(logs[j].logged_at)
        if t:
            last = t
    return last


def _build_user_sessions(
    logs: list,
    user: str,
    *,
    day: date,
    today: date,
    now: datetime,
    last_log_time: datetime,
) -> list[dict[str, Any]]:
    """
    Per user / day on this machine:
    - Pair all-zero punches: 1st → in_time, 2nd → working end; 3rd starts next shift, etc.
    - Open shift (odd punch count, today): working = now − in_time.
    - Machine run time: sum flag1 (seconds) for this user only between in_time and working end.
    """
    present_idx = _user_present_indexes(logs, user)
    if not present_idx:
        return []

    sessions: list[dict[str, Any]] = []
    i = 0
    while i < len(present_idx):
        start_i = present_idx[i]
        present_from = _sewing_wall_datetime(logs[start_i].logged_at)
        if not present_from:
            i += 1
            continue

        has_second = i + 1 < len(present_idx)
        if has_second:
            end_i = present_idx[i + 1]
            session_end = _sewing_wall_datetime(logs[end_i].logged_at) or present_from
            is_open = False
            span_stop = end_i
            i += 2
        elif day == today:
            session_end = _sewing_now_wall(now)
            is_open = True
            span_stop = len(logs)
            i += 1
        else:
            last_user = _last_log_time_for_user(logs, user, start_i) or last_log_time
            session_end = _sewing_wall_datetime(last_user) or present_from
            is_open = False
            span_stop = len(logs)
            i += 1

        runtime_total = 0
        for log in logs[start_i + 1 : span_stop]:
            if _machin_user_id(log) != user:
                continue
            runtime_total += log.flag1 or 0

        duration_sec = _duration_seconds(present_from, session_end)
        until_iso = None
        if not is_open and has_second:
            until_iso = logs[end_i].logged_at.isoformat() if logs[end_i].logged_at else None

        sessions.append(
            {
                "operator_id": user,
                "present_since": logs[start_i].logged_at.isoformat() if logs[start_i].logged_at else None,
                "present_until": until_iso,
                "present_duration_seconds": duration_sec,
                "present_duration_label": _format_duration(duration_sec),
                "runtime_total": runtime_total,
                "runtime_label": str(runtime_total),
                "open": is_open,
            }
        )

    return sessions


def lookup_daily_target(
    machin_id: int,
    on_date: date,
    *,
    operation_type: str = "sewing",
) -> int:
    row = (
        DailyTarget.objects.filter(machin_id=machin_id, date=on_date, operation_type=operation_type)
        .order_by("-id")
        .values_list("target", flat=True)
        .first()
    )
    if row is not None:
        return int(row)
    row = (
        DailyTarget.objects.filter(machin_id=machin_id, date=on_date)
        .order_by("-id")
        .values_list("target", flat=True)
        .first()
    )
    return int(row) if row is not None else 0


def lookup_day_line_target(
    floor: int,
    line_no: int,
    on_date: date,
    *,
    layout_id: int | None = None,
) -> tuple[str, int]:
    """Resolve (style, target_qty) for a line from day_line_target on a date.

    Tries the most specific key first (layout_id), then floor+line, then line.
    """
    from floors.models import DayLineTarget

    target = None
    if layout_id is not None:
        target = (
            DayLineTarget.objects.filter(layout_id=layout_id, date=on_date)
            .order_by("-id")
            .first()
        )
    if target is None and floor is not None and line_no is not None:
        target = (
            DayLineTarget.objects.filter(floor=floor, line=line_no, date=on_date)
            .order_by("-id")
            .first()
        )
    if target is None and line_no is not None:
        target = (
            DayLineTarget.objects.filter(line=line_no, date=on_date)
            .order_by("-id")
            .first()
        )
    if target is None:
        return "", 0
    return (target.style or ""), int(target.target_qty or 0)


def lookup_sewing_log_qty_totals(
    machin_id: int,
    machin_user: str,
    on_date: date,
) -> dict[str, int]:
    """Sum defect (flag2) and production (flag4) for machine / user / day."""
    uid = (machin_user or "").strip()
    if not uid:
        return {"defect_total": 0, "prod_total": 0}
    from django.db.models import Sum

    totals = SewingLog.objects.filter(
        machin_id=machin_id,
        machin_user=uid,
        logged_at__date=on_date,
    ).aggregate(
        defect_total=Sum("flag2"),
        prod_total=Sum("flag4"),
    )
    return {
        "defect_total": int(totals["defect_total"] or 0),
        "prod_total": int(totals["prod_total"] or 0),
    }


def _analysis_date(machin_id: int, preferred: date | None) -> date | None:
    if preferred:
        if SewingLog.objects.filter(machin_id=machin_id, logged_at__date=preferred).exists():
            return preferred
    latest = (
        SewingLog.objects.filter(machin_id=machin_id).order_by("-logged_at").values_list("logged_at", flat=True).first()
    )
    if latest:
        aware = _aware(latest)
        return aware.date() if aware else None
    return preferred


def _pick_display_session(sessions: list[dict[str, Any]], *, on_date: date, today: date) -> tuple[dict[str, Any], bool]:
    if not sessions:
        raise ValueError("no sessions")
    if on_date == today:
        open_sessions = [s for s in sessions if s["open"]]
        if open_sessions:
            return max(open_sessions, key=lambda s: s["present_since"]), True
    return max(sessions, key=lambda s: s["present_since"]), False


def _users_with_present_punches(logs: list) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for log in logs:
        if not _is_present_punch(log):
            continue
        uid = _machin_user_id(log)
        if uid and uid not in seen:
            seen.add(uid)
            ordered.append(uid)
    return ordered


def analyze_machin_logs(
    machin_id: int,
    *,
    on_date: date | None = None,
    now: datetime | None = None,
    strict_day: bool = False,
    machin_user: str | None = None,
) -> dict[str, Any]:
    """
    Per machine / day:
    - Each user with all-zero punches gets shifts (in pairs per day).
    - In time = first all-zero logged_at of the shift.
    - Working = 2nd all-zero logged_at − in_time, or now − in_time if no 2nd punch (today).
    - Machine run time = sum of flag1 (seconds) for that user only between in_time and working end.
    """
    now = _aware(now) or timezone.now()
    today = _sewing_now_wall(now).date()
    if strict_day and on_date is not None:
        day = on_date
    else:
        day = _analysis_date(machin_id, on_date or today) or today

    logs = list(
        SewingLog.objects.filter(machin_id=machin_id, logged_at__date=day).order_by("logged_at", "id")
    )

    empty: dict[str, Any] = {
        "analysis_date": day.isoformat(),
        "operator_present": False,
        "operator_id": "",
        "operator_name": "—",
        "operator_designation": "—",
        "operator_photo_url": None,
        "in_time": "—",
        "start_time": "—",
        "break_time_display": "0h 0m 0s",
        "out_time": "—",
        "total_working_display": "0h 0m 0s",
        "break_seconds": 0,
        "total_working_seconds": 0,
        "working_display": "—",
        "machine_run_display": "0 sec",
        "workstation_problem": "GREEN",
        "present_since": None,
        "present_until": None,
        "present_duration_seconds": 0,
        "present_duration_label": "0m",
        "runtime_total": 0,
        "runtime_label": "0",
        "has_problem": False,
        "problem_total": 0,
        "problem_label": "",
        "status": "offline",
        "flags": {"flag1": 0, "flag2": 0, "flag3": 0},
        "last_logged_at": None,
        "traffic_light_active": False,
        "non_productive_seconds": 0,
        "non_productive_display": "0h 0m 0s",
    }

    if not logs:
        return empty

    latest = logs[-1]
    non_productive_seconds = _calculate_non_productive_seconds(logs, day=day, today=today, now=now)
    traffic_active = _machine_traffic_light_active(logs)
    problem = _resolve_workstation_problem(logs)
    empty["flags"] = {"flag1": latest.flag1 or 0, "flag2": latest.flag2 or 0, "flag3": latest.flag3 or 0}
    empty["last_logged_at"] = latest.logged_at.isoformat() if latest.logged_at else None
    last_log_time = _aware(latest.logged_at) or now
    empty.update(
        {
            "traffic_light_active": traffic_active,
            "workstation_problem": problem["workstation_problem"] if traffic_active else "INACTIVE",
            "has_problem": problem["has_problem"] if traffic_active else False,
            "problem_total": problem["problem_total"],
            "problem_label": problem["problem_label"],
            "problem_state": problem["problem_state"] if traffic_active else "inactive",
            "problem_event_at": problem["problem_event_at"],
            "non_productive_seconds": non_productive_seconds,
            "non_productive_display": _non_productive_display(non_productive_seconds),
        }
    )

    users = _users_with_present_punches(logs)
    preferred_uid = (machin_user or "").strip()
    if not users:
        uid = preferred_uid or _machin_user_id(latest)
        hr = lookup_hr_profile(uid)
        runtime_total = sum(
            (log.flag1 or 0) for log in logs if _machin_user_id(log) == uid
        )
        user_sessions = _build_user_sessions(
            logs, uid, day=day, today=today, now=now, last_log_time=last_log_time
        )
        shift = _aggregate_shift_times(user_sessions)
        empty.update(
            {
                "operator_id": uid,
                "operator_name": _operator_display_name(uid),
                "operator_designation": hr.get("operator_designation", "—") if hr else "—",
                "operator_photo_url": hr.get("operator_photo_url") if hr else None,
                "in_time": shift["start_time"],
                "working_display": "—",
                "machine_run_display": _machine_run_display(runtime_total),
                "runtime_total": runtime_total,
                **shift,
            }
        )
        if problem["has_problem"]:
            empty["status"] = "problem"
        return empty

    sessions: list[dict[str, Any]] = []
    for user in users:
        sessions.extend(
            _build_user_sessions(
                logs,
                user,
                day=day,
                today=today,
                now=now,
                last_log_time=last_log_time,
            )
        )

    if not sessions:
        return empty

    if preferred_uid:
        user_sessions = [s for s in sessions if (s.get("operator_id") or "").strip() == preferred_uid]
        pool = user_sessions if user_sessions else sessions
    else:
        latest_uid = _machin_user_id(latest)
        user_sessions = [s for s in sessions if (s.get("operator_id") or "").strip() == latest_uid]
        pool = user_sessions if user_sessions else sessions
    current, operator_present = _pick_display_session(pool, on_date=day, today=today)

    status = "offline"
    if problem["has_problem"]:
        status = "problem"
    elif operator_present:
        status = "present"
    elif current["runtime_total"] > 0:
        status = "running"
    elif last_log_time and (now - last_log_time) < timedelta(hours=12):
        status = "idle"

    op_id = (current["operator_id"] or "").strip()
    hr = lookup_hr_profile(op_id)
    photo_url = hr.get("operator_photo_url") if hr else None
    display_sessions = _build_user_sessions(
        logs, op_id, day=day, today=today, now=now, last_log_time=last_log_time
    )
    shift = _aggregate_shift_times(display_sessions)
    return {
        **empty,
        "operator_present": operator_present,
        "operator_id": op_id,
        "operator_name": _operator_display_name(op_id),
        "operator_designation": hr.get("operator_designation", "—") if hr else _operator_designation(op_id),
        "operator_photo_url": photo_url,
        "in_time": shift["start_time"],
        **shift,
        "working_display": _working_display(current["present_duration_seconds"]),
        "machine_run_display": _machine_run_display(current["runtime_total"]),
        "workstation_problem": problem["workstation_problem"] if traffic_active else "INACTIVE",
        "present_since": current["present_since"],
        "present_until": current["present_until"],
        "present_duration_seconds": current["present_duration_seconds"],
        "present_duration_label": current["present_duration_label"],
        "runtime_total": current["runtime_total"],
        "runtime_label": current["runtime_label"],
        "has_problem": problem["has_problem"] if traffic_active else False,
        "problem_total": problem["problem_total"],
        "problem_label": problem["problem_label"],
        "problem_state": problem["problem_state"] if traffic_active else "inactive",
        "problem_event_at": problem["problem_event_at"],
        "traffic_light_active": traffic_active,
        "status": status if traffic_active else "offline",
        "non_productive_seconds": non_productive_seconds,
        "non_productive_display": _non_productive_display(non_productive_seconds),
    }


def rfid_present_status_from_logs(logs: list) -> str:
    """
    present_status for machin + user + day:
    - InActive when every flag3 is 0
    - Active when flag2=2 exists and every flag3 is 1
    - Otherwise Active if latest flag3 != 0, else InActive
    """
    if not logs:
        return "InActive"

    flag3_vals = [int(log.flag3 or 0) for log in logs]
    if all(v == 0 for v in flag3_vals):
        return "InActive"

    has_flag2_2 = any(int(log.flag2 or 0) == 2 for log in logs)
    if has_flag2_2 and all(v == 1 for v in flag3_vals):
        return "Active"

    return "Active" if flag3_vals[-1] != 0 else "InActive"


def _is_flag3_only_login_log(log) -> bool:
    """Operator IN punch: flag3=1 and flag1, flag2, flag4–flag9 all 0."""
    from mbm_automation.bundle_barcode import flag9_is_empty

    if int(log.flag3 or 0) != 1:
        return False
    for n in (1, 2, 4, 5, 6, 7, 8):
        if int(getattr(log, f"flag{n}", None) or 0) != 0:
            return False
    if not flag9_is_empty(getattr(log, "flag9", None)):
        return False
    return True


def _is_operator_login_log(log) -> bool:
    """RFID operator login punch (flag3=1 only; every other flag 0)."""
    return _is_flag3_only_login_log(log)


def _last_flag3_one_log(logs: list) -> SewingLog | None:
    """Most recent flag3=1 + all-other-flags-0 row (machin + user + day in_time)."""
    for i in range(len(logs) - 1, -1, -1):
        if _is_flag3_only_login_log(logs[i]):
            return logs[i]
    return None


def _last_operator_login_log(logs: list) -> SewingLog | None:
    """Most recent flag2=0, flag3=1 row (same user + machine + day)."""
    for i in range(len(logs) - 1, -1, -1):
        if _is_operator_login_log(logs[i]):
            return logs[i]
    return None


def _active_operator_login_log(logs: list) -> SewingLog | None:
    """
    Most recent flag3=1 (other flags 0) row not followed by flag3=0 for the same machin_user.
    """
    for i in range(len(logs) - 1, -1, -1):
        log = logs[i]
        if not _is_operator_login_log(log):
            continue
        uid = (log.machin_user or "").strip()
        if not uid:
            continue
        logged_out = any(
            int(later.flag3 or 0) == 0
            for later in logs[i + 1:]
            if (later.machin_user or "").strip() == uid
        )
        if not logged_out:
            return log
    return None


def resolve_active_machin_user(machin_id: int, on_date: date) -> str:
    """
    Current operator on a machine for the day (for sewing line cards).

    Returns machin_user from the most recent flag3=1 login (other flags 0) that has not
    been followed by flag3=0 for the same user. Rows with flag2/flag4 etc. set are ignored.
    """
    logs = list(
        SewingLog.objects.filter(machin_id=machin_id, logged_at__date=on_date).order_by("logged_at", "id")
    )
    login_log = _active_operator_login_log(logs)
    return (login_log.machin_user or "").strip() if login_log else ""


def enrich_rfid_shift_times(
    machin_id: int,
    machin_user: str,
    on_date: date,
    station: dict[str, Any],
) -> dict[str, Any]:
    """
    RFID WR / in_time / MRT from sewing_log for one machine + user + day:

    - in_time = logged_at of the latest row with flag3=1 and all other flags 0
    - WR = from that flag3=1 login until logout (flag3=0), or now when still active today
    - MRT = sum of flag1 for all rows that day
    - defect = sum of flag8 for all rows that day
    - production = sum of bundle qty for flag9 barcodes (legacy flag9=1 → +1)
    """
    from mbm_automation.bundle_barcode import sum_production_qtys

    uid = (machin_user or "").strip()
    logs = list(
        SewingLog.objects.filter(
            machin_id=machin_id,
            machin_user=uid,
            logged_at__date=on_date,
        ).order_by("logged_at", "id")
    )
    if not logs:
        return station

    first_from = _sewing_wall_datetime(logs[0].logged_at)
    last_from = _sewing_wall_datetime(logs[-1].logged_at)
    if not first_from:
        return station

    now = _aware(timezone.now()) or timezone.now()
    today = _sewing_now_wall(now).date()
    latest_flag3 = int(logs[-1].flag3 or 0)

    login_log = _last_flag3_one_log(logs)
    if login_log and login_log.logged_at:
        session_start = _sewing_wall_datetime(login_log.logged_at) or first_from
        formatted_in = _iso_to_local_ampm(login_log.logged_at.isoformat())
        login_idx = logs.index(login_log)
        logout_log = next(
            (log for log in logs[login_idx + 1:] if int(log.flag3 or 0) == 0),
            None,
        )
        if logout_log and logout_log.logged_at:
            session_end = _sewing_wall_datetime(logout_log.logged_at) or last_from
        elif latest_flag3 != 0 and on_date == today:
            session_end = _sewing_now_wall(now)
        else:
            session_end = last_from or session_start
    else:
        session_start = first_from
        formatted_in = "—"
        if latest_flag3 != 0 and on_date == today:
            session_end = _sewing_now_wall(now)
        else:
            session_end = last_from or first_from

    wr_sec = _duration_seconds(session_start, session_end)
    mrt_total = sum(int(log.flag1 or 0) for log in logs)
    # Defect / production now come from machin_production_count (QC data):
    # production = SUM(bundle_qty) - (SUM(defect) + SUM(reject)).
    from mbm_automation.bundle_barcode import machine_day_counts

    day_counts = machine_day_counts(machin_id, on_date)
    defect_total = day_counts["defect"] + day_counts["reject"]
    prod_total = day_counts["production"]
    present_status = rfid_present_status_from_logs(logs)

    return {
        **station,
        "in_time": formatted_in,
        "start_time": formatted_in,
        "present_duration_seconds": wr_sec,
        "working_display": _working_display(wr_sec),
        "total_working_seconds": wr_sec,
        "total_working_display": _duration_hms_display(wr_sec),
        "runtime_total": mrt_total,
        "runtime_label": str(mrt_total),
        "machine_run_display": _machine_run_display(mrt_total),
        "defect_total": defect_total,
        "prod_total": prod_total,
        "latest_flag3": latest_flag3,
        "has_flag2_2": any(int(log.flag2 or 0) == 2 for log in logs),
        "present_status": present_status,
        "operator_present": present_status == "Active",
    }
