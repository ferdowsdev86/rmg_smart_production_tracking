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
}

INTERVAL_CATEGORIES = frozenset(
    {
        "Machine & Utility Related",
        "Material Related",
        "Production Related",
    }
)


def _category_name_by_id() -> dict[int, str]:
    mapping: dict[int, str] = {}
    for row in NptLibrary.objects.values("catogery_id", "category"):
        cid = row["catogery_id"]
        if cid and cid not in mapping and row["category"]:
            mapping[cid] = row["category"]
    return mapping


def _floor_line_by_machine() -> dict[int, tuple[int, int]]:
    mapping: dict[int, tuple[int, int]] = {}
    for row in LineLayout.objects.values("machin_no", "floor", "line_no"):
        mapping.setdefault(row["machin_no"], (row["floor"], row["line_no"]))
    return mapping


def _flag_npt_intervals(
    logs,
    flag_attr: str,
    *,
    use_flag2_stop: bool = False,
) -> list[dict]:
    """Pair start (flag=1) → stop; remaining open starts are returned as in-progress rows.

    For machine NPT (flag4), one open session per machine. Stop via flag=2, flag2=1
    (any machin_user on the same machine / date / line — flag2 logged_at is the end
    time), or a new flag=1 (implicit stop).
    """
    # Single open session per machine: (start_ts, start_id, machin_user)
    open_session: Optional[tuple[datetime, int, str]] = None
    intervals: list[dict] = []

    def _close(stop_ts: datetime, stop_id: int, stop_type: str) -> None:
        nonlocal open_session
        if open_session is None:
            return
        start_ts, start_id, user = open_session
        open_session = None
        seconds = max(0.0, (stop_ts - start_ts).total_seconds())
        intervals.append(
            {
                "start_id": start_id,
                "stop_id": stop_id,
                "machin_user": user,
                "start_at": timezone.localtime(start_ts).strftime("%H:%M:%S"),
                "stop_at": timezone.localtime(stop_ts).strftime("%H:%M:%S"),
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
            open_session = (ts, log.id, user)
            continue

        if flag_val == 2:
            _close(ts, log.id, f"{flag_attr}=2")
        elif use_flag2_stop and flag2 == 1:
            # Same machine / date / line — flag2 logged_at ends the open NPT.
            _close(ts, log.id, "flag2=1")

    if open_session is not None:
        start_ts, start_id, user = open_session
        intervals.append(
            {
                "start_id": start_id,
                "stop_id": 0,
                "machin_user": user,
                "start_at": timezone.localtime(start_ts).strftime("%H:%M:%S"),
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
    return {
        "unit": "",
        "machin_id": mid,
        "floor": floor,
        "line": line,
        "date": on_date,
        "category": category,
        "start_log_id": iv["start_id"],
        "stop_log_id": iv["stop_id"],
        "start_at": iv["start_at"],
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
    )

    for mid, machine_logs in by_machine.items():
        floor, line = floor_line.get(mid, (0, 0))

        for flag_attr, category_id, use_flag2_stop in interval_specs:
            category = category_by_id.get(category_id, "")
            if not category:
                continue
            for iv in _flag_npt_intervals(
                machine_logs, flag_attr, use_flag2_stop=use_flag2_stop
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
