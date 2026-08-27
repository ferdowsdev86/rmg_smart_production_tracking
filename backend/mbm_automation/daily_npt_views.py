"""Daily NPT list — derived from sewing_log flags, stored in daily_npt_status.

GET  /api/automation/daily_npt/?date=YYYY-MM-DD
    Read back persisted rows — one row per NPT event/session.
POST /api/automation/daily_npt/
    Re-derive from sewing_log and persist any missing event rows.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.models import DailyNptStatus, NptLibrary
from mbm_automation.npt_status import (
    build_daily_npt_list,
    reason_confirm_allowed,
    sync_daily_npt_status,
)


def _parse_date(value):
    if not value:
        return None, None
    value = str(value).strip()
    if not value:
        return None, None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date(), None
    except ValueError:
        return None, Response(
            {"detail": "Invalid date. Use YYYY-MM-DD."}, status=400
        )


def _serialize(row: DailyNptStatus, live: Optional[dict] = None) -> dict:
    extra = live or {}
    stop_log_id = extra.get("stop_log_id", row.stop_log_id)
    category = row.category
    return {
        "id": row.id,
        "unit": row.unit,
        "machin_id": row.machin_id,
        "floor": row.floor,
        "line": row.line,
        "date": row.date,
        "category": category,
        "start_log_id": row.start_log_id,
        "stop_log_id": stop_log_id,
        "start_at": extra.get("start_at", ""),
        "stop_at": extra.get("stop_at", ""),
        "is_open": extra.get(
            "is_open",
            stop_log_id == 0 and category in (
                "Machine & Utility Related",
                "Material Related",
                "Production Related",
            ),
        ),
        "can_confirm_reason": reason_confirm_allowed(
            category,
            stop_log_id,
            is_open=extra.get(
                "is_open",
                stop_log_id == 0 and category in (
                    "Machine & Utility Related",
                    "Material Related",
                    "Production Related",
                ),
            ),
        ),
        "npt_reason": row.npt_reason,
        "npt_hour": extra.get("npt_hour", row.npt_hour),
        "remarks": row.remarks,
    }


def _serialize_live(entry: dict, persisted: Optional[DailyNptStatus] = None) -> dict:
    """Merge live sewing_log event with persisted row (if any)."""
    if persisted:
        return _serialize(persisted, entry)
    category = entry.get("category", "")
    stop_log_id = entry.get("stop_log_id", 0)
    return {
        "id": None,
        "unit": entry.get("unit", ""),
        "machin_id": entry["machin_id"],
        "floor": entry["floor"],
        "line": entry["line"],
        "date": entry["date"],
        "category": category,
        "start_log_id": entry["start_log_id"],
        "stop_log_id": stop_log_id,
        "start_at": entry.get("start_at", ""),
        "stop_at": entry.get("stop_at", ""),
        "is_open": entry.get("is_open", False),
        "can_confirm_reason": reason_confirm_allowed(
            category,
            stop_log_id,
            is_open=entry.get("is_open", False),
        ),
        "npt_reason": "",
        "npt_hour": entry.get("npt_hour", 0),
        "remarks": "",
    }


def _merged_results(on_date):
    """Live list from sewing_log merged with persisted daily_npt_status."""
    live_entries = build_daily_npt_list(on_date)
    persisted = {
        r.start_log_id: r
        for r in DailyNptStatus.objects.filter(date=on_date, start_log_id__gt=0)
    }
    if live_entries:
        return [
            _serialize_live(e, persisted.get(e["start_log_id"]))
            for e in live_entries
        ]
    # Fallback: legacy aggregated rows
    return [
        _serialize(r)
        for r in DailyNptStatus.objects.filter(date=on_date).order_by(
            "floor", "line", "machin_id", "category"
        )
    ]


class DailyNptStatusView(APIView):
    def get(self, request):
        on_date, err = _parse_date(request.query_params.get("date"))
        if err is not None:
            return err
        if on_date is None:
            on_date = timezone.localdate()
        results = _merged_results(on_date)
        return Response({"date": on_date, "count": len(results), "results": results})

    def post(self, request):
        raw = request.data.get("date") if isinstance(request.data, dict) else None
        on_date, err = _parse_date(raw or request.query_params.get("date"))
        if err is not None:
            return err
        try:
            summary = sync_daily_npt_status(on_date)
        except Exception as exc:
            return Response(
                {"detail": f"Failed to sync daily NPT status: {exc}"}, status=500
            )
        rows = _merged_results(summary["date"])
        return Response({**summary, "results": rows}, status=200)


class DailyNptStatusDetailView(APIView):
    def patch(self, request, pk: int):
        try:
            row = DailyNptStatus.objects.get(pk=pk)
        except DailyNptStatus.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)

        data = request.data if isinstance(request.data, dict) else {}

        live = {
            e["start_log_id"]: e
            for e in build_daily_npt_list(row.date)
        }
        live_row = live.get(row.start_log_id, {})
        stop_log_id = live_row.get("stop_log_id", row.stop_log_id)
        if not reason_confirm_allowed(
            row.category,
            stop_log_id,
            is_open=live_row.get("is_open", False),
        ):
            return Response(
                {"detail": "NPT must end before confirming reason."},
                status=400,
            )

        if "reasons" in data and isinstance(data["reasons"], list):
            reasons = [str(r).strip() for r in data["reasons"] if str(r).strip()]
            row.npt_reason = ", ".join(reasons)
        elif "npt_reason" in data:
            row.npt_reason = str(data.get("npt_reason") or "").strip()

        if "remarks" in data:
            row.remarks = str(data.get("remarks") or "").strip()

        row.save(update_fields=["npt_reason", "remarks"])
        return Response(_serialize(row, live_row))


class NptLibraryView(APIView):
    def get(self, request):
        catogery_id = request.query_params.get("catogery_id")
        category = request.query_params.get("category")

        qs = NptLibrary.objects.all().order_by("catogery_id", "npt_reason")
        if catogery_id not in (None, ""):
            try:
                qs = qs.filter(catogery_id=int(catogery_id))
            except (TypeError, ValueError):
                pass
        if category:
            qs = qs.filter(category=category)

        groups: dict = {}
        order: list = []
        for row in qs:
            key = row.catogery_id
            if key not in groups:
                groups[key] = {
                    "catogery_id": row.catogery_id,
                    "category": row.category,
                    "reasons": [],
                }
                order.append(key)
            groups[key]["reasons"].append({"id": row.id, "npt_reason": row.npt_reason})

        return Response({"groups": [groups[k] for k in order]})
