"""NPT Summary (AQL) report.

A cross-tab over ``daily_npt_status``: one row per NPT event, with the event's
total loss time placed under its own ``npt_library`` reason column.

Enrichment:
- floor / line names → ERP hr_floor / hr_line (via ``floor_line_labels``)
- buyer / style      → ``day_qc_diffect`` (same source as the Production report),
                       matched by (date, line)
- effective MP       → number of machines that share the SAME npt_reason on the
                       SAME date
- start / end time   → ``sewing_log`` timestamps of the start/stop log ids

Loss Time (Min) = npt_hour × 60.  Total Loss Time = Loss Time × Effective MP.
"""

from collections import defaultdict

from django.db import connections
from django.utils import timezone

from floors.models import DailyNptStatus, NptLibrary
from mbm_automation.npt_status import floor_line_labels
from mbm_automation.models import SewingLog


def _fmt_time(dt) -> str:
    """'02.50 PM' style, in local time, matching the source spreadsheet."""
    if not dt:
        return ""
    return timezone.localtime(dt).strftime("%I.%M %p")


def _library_columns() -> list[dict]:
    """Cross-tab columns — one per distinct npt_library reason."""
    columns: list[dict] = []
    seen: set[str] = set()
    for row in NptLibrary.objects.all().order_by("catogery_id", "npt_reason"):
        reason = (row.npt_reason or "").strip()
        if reason and reason not in seen:
            seen.add(reason)
            columns.append(
                {"reason": reason, "category": row.category, "catogery_id": row.catogery_id}
            )
    return columns


def _buyer_style_map(start_date, end_date) -> dict[tuple[str, int], tuple[str, str]]:
    """(date_iso, line) → (buyer, style) from day_qc_diffect.

    Same table the Production report reads; picks the most frequent non-empty
    buyer/style seen on that line that day.
    """
    counts: dict[tuple[str, int], dict[tuple[str, str], int]] = defaultdict(
        lambda: defaultdict(int)
    )
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT date, COALESCE(line,0), COALESCE(buyer,''), COALESCE(style,''), "
                "COUNT(*) FROM day_qc_diffect "
                "WHERE date BETWEEN %s AND %s AND COALESCE(style,'') <> '' "
                "GROUP BY date, line, buyer, style",
                [start_date, end_date],
            )
            for d, line, buyer, style, c in cursor.fetchall():
                key = (d.isoformat() if hasattr(d, "isoformat") else str(d), int(line or 0))
                counts[key][((buyer or "").strip(), (style or "").strip())] += int(c or 0)
    except Exception:
        pass

    out: dict[tuple[str, int], tuple[str, str]] = {}
    for key, combos in counts.items():
        best = max(combos.items(), key=lambda kv: kv[1])[0]
        out[key] = best
    return out


def npt_summary_report(start_date, end_date) -> dict:
    rows = list(
        DailyNptStatus.objects.filter(date__range=(start_date, end_date)).order_by("date", "id")
    )

    columns = _library_columns()
    valid_reasons = {c["reason"] for c in columns}

    buyer_style = _buyer_style_map(start_date, end_date)

    # Effective MP = distinct machines sharing the same npt_reason on the same
    # date. Keyed by (date, reason).
    machines_by_reason: dict[tuple, set] = defaultdict(set)
    for r in rows:
        reason_key = (r.npt_reason or "").strip()
        machines_by_reason[(r.date, reason_key)].add(int(r.machin_id or 0))

    # start/stop times from sewing_log
    log_ids = set()
    for r in rows:
        if r.start_log_id:
            log_ids.add(int(r.start_log_id))
        if r.stop_log_id:
            log_ids.add(int(r.stop_log_id))
    log_times = {
        lid: ts
        for lid, ts in SewingLog.objects.filter(id__in=list(log_ids)).values_list(
            "id", "logged_at"
        )
    }

    out_rows: list[dict] = []
    column_totals: dict[str, int] = defaultdict(int)
    reason_agg: dict[str, dict] = defaultdict(lambda: {"loss": 0, "total": 0, "events": 0})
    grand_loss = 0
    grand_total = 0

    for r in rows:
        floor = int(r.floor or 0)
        line = int(r.line or 0)
        floor_label, line_label = floor_line_labels(floor, line)
        buyer, style = buyer_style.get((r.date.isoformat(), line), ("", ""))

        reason = (r.npt_reason or "").strip()
        effective_mp = len(machines_by_reason.get((r.date, reason), set()))

        loss_min = round((r.npt_hour or 0) * 60)
        total_loss = loss_min * effective_mp

        col_reason = reason if reason in valid_reasons else ""
        if col_reason:
            column_totals[col_reason] += total_loss
            a = reason_agg[col_reason]
            a["loss"] += loss_min
            a["total"] += total_loss
            a["events"] += 1
        grand_loss += loss_min
        grand_total += total_loss

        out_rows.append(
            {
                "id": r.id,
                "date": r.date.isoformat(),
                "month": r.date.strftime("%b").upper(),
                "floor": floor_label,
                "line": line_label,
                "buyer": buyer,
                "style": style,
                "start_time": _fmt_time(log_times.get(int(r.start_log_id or 0))),
                "end_time": _fmt_time(log_times.get(int(r.stop_log_id or 0))),
                "loss_min": loss_min,
                "effective_mp": effective_mp,
                "total_loss_min": total_loss,
                "reason": col_reason,
                "category": r.category,
                "remarks": r.remarks or "",
            }
        )

    cat_by_reason = {c["reason"]: c["category"] for c in columns}
    reason_summary = sorted(
        (
            {
                "reason": k,
                "category": cat_by_reason.get(k, ""),
                "loss_min": v["loss"],
                "effective_mp": round(v["total"] / v["loss"], 1) if v["loss"] else 0,
                "total_loss": v["total"],
                "events": v["events"],
            }
            for k, v in reason_agg.items()
        ),
        key=lambda x: -x["total_loss"],
    )
    # weighted average MP across all classified loss (Total ÷ Loss)
    effective_mp_avg = round(grand_total / grand_loss, 2) if grand_loss else 0

    return {
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "columns": columns,
        "rows": out_rows,
        "column_totals": dict(column_totals),
        "reason_summary": reason_summary,
        "effective_mp_avg": effective_mp_avg,
        "grand_total_loss_min": grand_loss,
        "grand_total": grand_total,
        "count": len(out_rows),
    }
