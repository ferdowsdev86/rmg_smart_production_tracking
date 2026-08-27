"""Helpers for the daily machine maintenance CRUD.

The selectable machine list comes from ``sewing_log`` rows where ``flag9 = 1``
(auto-routed to the ``mbm_automation`` DB). Names are enriched from the local
``machin_library`` table, matched by ``machin_no``.

The derived daily maintenance list comes from ``sewing_log`` rows where
``flag4 = 1`` (Machine & Utility Related), grouped per date + machin_id.
"""

from collections import defaultdict
from datetime import date as date_cls
from typing import Optional

from django.utils import timezone

from floors.models import MachinLibrary
from mbm_automation.models import SewingLog


def available_machine_ids() -> set[int]:
    """Distinct machin_id values from sewing_log where flag9 = 1."""
    return {
        int(mid)
        for mid in SewingLog.objects.filter(flag9=1)
        .exclude(machin_id__isnull=True)
        .values_list("machin_id", flat=True)
        .distinct()
    }


def machine_name_map(machin_nos) -> dict[int, str]:
    """Map machin_no -> machin_name from machin_library for the given ids."""
    if not machin_nos:
        return {}
    return {
        int(row.machin_no): row.machin_name
        for row in MachinLibrary.objects.filter(machin_no__in=list(machin_nos))
    }


def available_machines() -> list[dict]:
    """List of selectable machines: [{machin_id, machin_name, label}, ...]."""
    ids = sorted(available_machine_ids())
    names = machine_name_map(ids)
    out = []
    for mid in ids:
        name = names.get(mid, "")
        label = f"#{mid} · {name}" if name else f"#{mid}"
        out.append({"machin_id": mid, "machin_name": name, "label": label})
    return out


def derive_daily_machine_maintenance(on_date: Optional[date_cls] = None) -> list[dict]:
    """Derive maintenance events from sewing_log (flag4 = 1) for ``on_date``.

    One row per machin_id with the number of flag4 events that day plus the
    first/last event times. Machine names come from machin_library.
    """
    if on_date is None:
        on_date = timezone.localdate()

    logs = SewingLog.objects.filter(logged_at__date=on_date, flag4=1).exclude(
        machin_id__isnull=True
    )

    agg: dict[int, dict] = defaultdict(
        lambda: {"count": 0, "first": None, "last": None, "events": []}
    )
    for log in logs:
        d = agg[int(log.machin_id)]
        d["count"] += 1
        ts = log.logged_at
        d["events"].append(
            {
                "id": log.id,
                "logged_at": timezone.localtime(ts).strftime("%H:%M:%S") if ts else None,
            }
        )
        if ts is not None:
            if d["first"] is None or ts < d["first"]:
                d["first"] = ts
            if d["last"] is None or ts > d["last"]:
                d["last"] = ts

    names = machine_name_map(agg.keys())
    out = []
    for mid, d in agg.items():
        events = sorted(d["events"], key=lambda e: e["logged_at"] or "")
        out.append(
            {
                "date": on_date,
                "machin_id": mid,
                "machin_name": names.get(mid, ""),
                "count": d["count"],
                "events": events,
                "first_seen": timezone.localtime(d["first"]).strftime("%H:%M:%S")
                if d["first"]
                else None,
                "last_seen": timezone.localtime(d["last"]).strftime("%H:%M:%S")
                if d["last"]
                else None,
            }
        )
    out.sort(key=lambda x: (-x["count"], x["machin_id"]))
    return out
