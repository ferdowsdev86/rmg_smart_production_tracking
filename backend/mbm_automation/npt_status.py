"""Derive the daily NPT list from sewing_log flags.

Each sewing_log row carries NPT category flags:

    flag4 → catogery_id 1 → "Machine & Utility Related"
    flag5 → catogery_id 2 → "Material Related"
    flag6 → catogery_id 3 → "Production Related"

**One list row per NPT event/session** (open or closed).

Machine / Production / Material: show on flag=1 start; update when stopped.
Stop via flag=2, flag2=1 (same machine / date / line — flag2 logged_at is end
time, even if machin_user differs), or a new flag=1 (implicit stop).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from django.utils import timezone

from floors.models import DailyNptStatus, NptLibrary
from mbm_automation.models import LineLayout, SewingLog

CATEGORY_ID_BY_FLAG = {
    "flag4": NptLibrary.CATEGORY_MACHINE,
    "flag5": NptLibrary.CATEGORY_MATERIAL,
    "flag6": NptLibrary.CATEGORY_PRODUCTION,
    "flag7": NptLibrary.CATEGORY_TECHNICAL,
}

INTERVAL_CATEGORIES = frozenset(
    {
        "Machine & Utility Related",
        "Material Related",
        "Production Related",
        "Technical Related",
    }
)

# Devices switched to the 3-stage protocol (1 = operator call, 2 = responder
# punched in, 3 = IE confirmed end) on this date; before it, flag=2 ended NPT.
NPT_STAGE_PROTOCOL_DATE = date(2026, 10, 22)

DEFAULT_CATEGORY_NAMES = {
    NptLibrary.CATEGORY_MACHINE: "Machine & Utility Related",
    NptLibrary.CATEGORY_MATERIAL: "Material Related",
    NptLibrary.CATEGORY_PRODUCTION: "Production Related",
    NptLibrary.CATEGORY_TECHNICAL: "Technical Related",
}


def _category_name_by_id() -> dict[int, str]:
    mapping: dict[int, str] = dict(DEFAULT_CATEGORY_NAMES)
    for row in NptLibrary.objects.values("catogery_id", "category"):
        cid = row["catogery_id"]
        if cid and row["category"]:
            mapping[cid] = row["category"]
    return mapping


def _floor_line_by_machine() -> dict[int, tuple[int, int]]:
    mapping: dict[int, tuple[int, int]] = {}
    for row in LineLayout.objects.values("machin_no", "floor", "line_no"):
        mapping.setdefault(row["machin_no"], (row["floor"], row["line_no"]))
    return mapping


# (floor, line) → ("G-FLR", "A09") labels from the ERP (cuttingedgedb hr_line /
# hr_floor). line_layout.line_no IS the ERP hr_line_id.
_FLOOR_LINE_LABEL_CACHE: dict[tuple[int, int], tuple[str, str]] = {}


def floor_line_labels(floor: int, line: int) -> tuple[str, str]:
    key = (int(floor or 0), int(line or 0))
    cached = _FLOOR_LINE_LABEL_CACHE.get(key)
    if cached is not None:
        return cached
    floor_label, line_label = "", ""
    try:
        from django.db import connections

        with connections["cuttingedge"].cursor() as cursor:
            if key[1]:
                cursor.execute(
                    "SELECT hr_line_name, hr_line_floor_id FROM hr_line "
                    "WHERE hr_line_id = %s",
                    [key[1]],
                )
                r = cursor.fetchone()
                if r:
                    line_label = (r[0] or "").strip()
                    floor_id = r[1] or key[0]
                else:
                    floor_id = key[0]
            else:
                floor_id = key[0]
            if floor_id:
                cursor.execute(
                    "SELECT hr_floor_name FROM hr_floor WHERE hr_floor_id = %s",
                    [floor_id],
                )
                r = cursor.fetchone()
                if r:
                    floor_label = (r[0] or "").strip()
    except Exception:
        pass
    labels = (
        floor_label or (str(key[0]) if key[0] else "—"),
        line_label or (str(key[1]) if key[1] else "—"),
    )
    _FLOOR_LINE_LABEL_CACHE[key] = labels
    return labels


def _flag_npt_intervals(
    logs,
    flag_attr: str,
    *,
    use_flag2_stop: bool = False,
    stop_on_two: bool = True,
) -> list[dict]:
    """Pair start (flag=1) → stop; remaining open starts are returned as in-progress rows.

    For machine NPT (flag4), one open session per machine. Stop via flag=2, flag2=1
    (any machin_user on the same machine / date / line — flag2 logged_at is the end
    time), or a new flag=1 (implicit stop).
    """
    # Single open session per machine: [start_ts, start_id, machin_user, responder_ts]
    open_session: Optional[list] = None
    intervals: list[dict] = []

    def _fmt(ts) -> str:
        return timezone.localtime(ts).strftime("%H:%M:%S") if ts else ""

    def _close(stop_ts: datetime, stop_id: int, stop_type: str) -> None:
        nonlocal open_session
        if open_session is None:
            return
        start_ts, start_id, user, responder_ts = open_session
        open_session = None
        seconds = max(0.0, (stop_ts - start_ts).total_seconds())
        intervals.append(
            {
                "start_id": start_id,
                "stop_id": stop_id,
                "machin_user": user,
                "start_at": _fmt(start_ts),
                "calling_at": _fmt(start_ts),
                "responder_at": _fmt(responder_ts),
                "stop_at": _fmt(stop_ts),
                "seconds": round(seconds, 1),
                "minutes": round(seconds / 60.0, 2),
                "stop_type": stop_type,
                "npt_hour": round(seconds / 3600.0, 4),
                "is_open": False,
            }
        )

    for log in logs:
        ts = log.logged_at
        if ts is None:
            continue
        user = str(log.machin_user or "")
        flag_val = int(getattr(log, flag_attr, 0) or 0)
        flag2 = int(log.flag2 or 0)

        if flag_val == 1:
            if open_session is not None:
                _close(ts, log.id, f"{flag_attr}=1 (implicit stop)")
            open_session = [ts, log.id, user, None]
            continue

        if flag_val == 3:
            # Stage protocol: 3 = IE confirmed the NPT has ended.
            _close(ts, log.id, f"{flag_attr}=3")
        elif flag_val == 2:
            # Stage protocol: 2 = responder punched in — NPT keeps running.
            # Legacy data (before the protocol date) used 2 as the stop.
            if stop_on_two:
                _close(ts, log.id, f"{flag_attr}=2")
            elif open_session is not None and open_session[3] is None:
                open_session[3] = ts
        elif use_flag2_stop and flag2 == 1:
            # Same machine / date / line — flag2 logged_at ends the open NPT.
            _close(ts, log.id, "flag2=1")

    if open_session is not None:
        start_ts, start_id, user, responder_ts = open_session
        intervals.append(
            {
                "start_id": start_id,
                "stop_id": 0,
                "machin_user": user,
                "start_at": _fmt(start_ts),
                "calling_at": _fmt(start_ts),
                "responder_at": _fmt(responder_ts),
                "stop_at": "",
                "seconds": 0,
                "minutes": 0,
                "stop_type": "",
                "npt_hour": 0,
                "is_open": True,
            }
        )

    return intervals


def _entry_from_interval(
    iv: dict,
    *,
    on_date: date,
    mid: int,
    floor: int,
    line: int,
    category: str,
) -> dict:
    floor_label, line_label = floor_line_labels(floor, line)
    return {
        "unit": "",
        "machin_id": mid,
        "floor": floor,
        "line": line,
        "floor_label": floor_label,
        "line_label": line_label,
        "date": on_date,
        "category": category,
        "start_log_id": iv["start_id"],
        "stop_log_id": iv["stop_id"],
        "start_at": iv["start_at"],
        "calling_at": iv.get("calling_at", iv["start_at"]),
        "responder_at": iv.get("responder_at", ""),
        "stop_at": iv["stop_at"],
        "is_open": iv.get("is_open", False),
        "npt_reason": "",
        "npt_hour": iv["npt_hour"],
        "remarks": "",
    }


def build_daily_npt_list(on_date: Optional[date] = None) -> list[dict]:
    """One entry per NPT event/session (including in-progress) for ``on_date``."""
    if on_date is None:
        on_date = timezone.localdate()

    category_by_id = _category_name_by_id()
    floor_line = _floor_line_by_machine()

    logs = (
        SewingLog.objects.filter(logged_at__date=on_date)
        .exclude(machin_id__isnull=True)
        .order_by("machin_id", "logged_at", "id")
    )

    by_machine: dict[int, list] = {}

    for log in logs:
        mid = int(log.machin_id)
        by_machine.setdefault(mid, []).append(log)

    entries: list[dict] = []

    interval_specs = (
        ("flag4", NptLibrary.CATEGORY_MACHINE, True),
        ("flag5", NptLibrary.CATEGORY_MATERIAL, True),
        ("flag6", NptLibrary.CATEGORY_PRODUCTION, True),
        ("flag7", NptLibrary.CATEGORY_TECHNICAL, True),
    )
    legacy_stop_on_two = on_date < NPT_STAGE_PROTOCOL_DATE

    for mid, machine_logs in by_machine.items():
        floor, line = floor_line.get(mid, (0, 0))

        for flag_attr, category_id, use_flag2_stop in interval_specs:
            category = category_by_id.get(category_id, "")
            if not category:
                continue
            for iv in _flag_npt_intervals(
                machine_logs, flag_attr,
                use_flag2_stop=use_flag2_stop,
                stop_on_two=legacy_stop_on_two,
            ):
                if not iv.get("is_open") and iv["npt_hour"] <= 0:
                    continue
                entries.append(
                    _entry_from_interval(
                        iv,
                        on_date=on_date,
                        mid=mid,
                        floor=floor,
                        line=line,
                        category=category,
                    )
                )

    entries.sort(
        key=lambda e: (
            e["floor"],
            e["line"],
            e["machin_id"],
            e["category"],
            e["start_log_id"],
        )
    )
    return entries


def sync_daily_npt_status(on_date: Optional[date] = None) -> dict:
    """Persist one daily_npt_status row per NPT event (keyed by start_log_id)."""
    if on_date is None:
        on_date = timezone.localdate()

    entries = build_daily_npt_list(on_date)
    created = 0
    updated = 0
    for e in entries:
        existing = DailyNptStatus.objects.filter(
            date=e["date"],
            machin_id=e["machin_id"],
            start_log_id=e["start_log_id"],
        ).first()
        if existing is None:
            DailyNptStatus.objects.create(
                date=e["date"],
                machin_id=e["machin_id"],
                floor=e["floor"],
                line=e["line"],
                category=e["category"],
                start_log_id=e["start_log_id"],
                stop_log_id=e["stop_log_id"],
                unit=e["unit"],
                npt_reason="",
                npt_hour=e["npt_hour"],
            )
            created += 1
        else:
            changed = False
            if existing.npt_hour != e["npt_hour"]:
                existing.npt_hour = e["npt_hour"]
                changed = True
            if existing.stop_log_id != e["stop_log_id"]:
                existing.stop_log_id = e["stop_log_id"]
                changed = True
            if changed:
                existing.save(update_fields=["npt_hour", "stop_log_id"])
            updated += 1

    return {
        "date": on_date,
        "matched": len(entries),
        "created": created,
        "existing": updated,
    }


def reason_confirm_allowed(category: str, stop_log_id: int, *, is_open: bool = False) -> bool:
    """Interval categories need a stop before confirming reason."""
    if category not in INTERVAL_CATEGORIES:
        return True
    if is_open:
        return False
    return stop_log_id > 0
