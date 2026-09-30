"""POST day_sew_target — log a sewing scan and return that machine's daily target.

Receives ``machin_id`` + ``logged_at``, stores a row in ``sewing_log``, then
resolves the machine's line/floor from ``line_layout`` (active machine) and the
date-wise target from the ERP:
  cuttingedgedb.pt_sewing_daily_line_targets   (line day target_qty + hours)
  cuttingedgedb.daily_line_style_targets       (stl_no per style)

App floor/line → ERP hr_line_id mapping via env DAILY_TARGET_HR_LINE_MAP,
format "floor:line=hr_line_id[,floor:line=hr_line_id…]".

GET with ``?machin_id=`` returns the same target payload (read-only, no log row).
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.camera_data_views import CameraIngestPermission
from mbm_automation.automation_api_urls import day_sew_target_urls
from mbm_automation.iotdatastore_views import _serialize_row, _sewing_log_on_date
from mbm_automation.models import LineLayout, SewingLog


class DaySewTargetInputSerializer(serializers.Serializer):
    machin_id = serializers.IntegerField(min_value=0)
    logged_at = serializers.DateTimeField(required=False, allow_null=True)


def _parse_on_date(raw: str | None) -> date:
    if raw:
        try:
            return datetime.strptime(str(raw).strip()[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    return timezone.localdate()


def _break_duration_hours(break_st, break_end) -> float:
    """Hours between break_st and break_end.

    TIME values (or datetime.time): duration in hours; minutes become a fraction
    (e.g. 30 min → 0.5) and are subtracted from target_hour.
    """
    if break_st is None or break_end is None:
        return 0.0
    if not isinstance(break_st, time) or not isinstance(break_end, time):
        return 0.0
    if break_st == break_end:
        return 0.0

    base = date(2000, 1, 1)
    start = datetime.combine(base, break_st)
    end = datetime.combine(base, break_end)
    if end < start:
        end += timedelta(days=1)
    seconds = (end - start).total_seconds()
    if seconds <= 0:
        return 0.0
    return seconds / 3600.0


def _calc_hour_target(target_qty: int, target_hour, break_st, break_end) -> int:
    """hour_target = round(target_qty / (target_hour - break_duration))."""
    try:
        qty = int(target_qty or 0)
    except (TypeError, ValueError):
        qty = 0
    try:
        hours = float(target_hour or 0)
    except (TypeError, ValueError):
        hours = 0.0
    if qty <= 0 or hours <= 0:
        return 0

    working_hours = hours - _break_duration_hours(break_st, break_end)
    if working_hours <= 0:
        return 0
    return int(round(qty / working_hours))


def _hr_line_map() -> dict[tuple[int, int], int]:
    """Optional override map DAILY_TARGET_HR_LINE_MAP: "floor:line=hr_line_id,…".
    By default line_layout.line_no IS the ERP hr_line_id (e.g. 327 = A09)."""
    from core.env import config

    raw = (config("DAILY_TARGET_HR_LINE_MAP", default="") or "").strip()
    mapping: dict[tuple[int, int], int] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part or "=" not in part or ":" not in part:
            continue
        try:
            fl, hr = part.split("=")
            f, l = fl.split(":")
            mapping[(int(f), int(l))] = int(hr)
        except (TypeError, ValueError):
            continue
    return mapping


def _resolve_day_sew_target(machin_id: int, on_date: date) -> dict:
    """floor/line from line_layout (active machine); target_qty / stl_no
    date-wise from cuttingedgedb pt_sewing_daily_line_targets +
    daily_line_style_targets."""
    from django.db import connections

    line_row = LineLayout.objects.filter(machin_no=machin_id).first()

    floor = line_no = layout_id = None
    if line_row is not None:
        floor, line_no = line_row.floor, line_row.line_no

    style, target_qty, hour_target = "", 0, 0
    styles: list[str] = []
    # line_layout.line_no is the ERP hr_line_id. Optional env map overrides
    # only when an explicit floor:line entry exists (e.g. 1:1=335).
    hr_line_id = None
    if line_no is not None:
        override = _hr_line_map().get((floor, line_no)) if floor is not None else None
        hr_line_id = override if override is not None else int(line_no)

    if hr_line_id is not None:
        try:
            with connections["cuttingedge"].cursor() as cursor:
                cursor.execute(
                    "SELECT id, target_qty, hour, layout_id "
                    "FROM pt_sewing_daily_line_targets "
                    "WHERE hr_line_id = %s AND production_date = %s "
                    "ORDER BY id DESC LIMIT 1",
                    [hr_line_id, on_date],
                )
                parent = cursor.fetchone()
                if parent:
                    pt_id = parent[0]
                    target_qty = int(parent[1] or 0)
                    hours = float(parent[2] or 0)
                    layout_id = parent[3] or None
                    if target_qty and hours > 0:
                        hour_target = int(round(target_qty / hours))
                    # Style names only — target_qty comes from the parent row.
                    cursor.execute(
                        # insertion order so the LAST entry is the newest style
                        "SELECT stl_no FROM daily_line_style_targets "
                        "WHERE pt_sewing_id = %s AND deleted_at IS NULL "
                        "ORDER BY id",
                        [pt_id],
                    )
                    seen = set()
                    for (stl_no,) in cursor.fetchall():
                        name = (stl_no or "").strip()
                        if name and name not in seen:
                            seen.add(name)
                            styles.append(name)
                    style = ", ".join(styles)
        except Exception:
            pass  # ERP unreachable — return zeros rather than fail the scan

    return {
        "machin_id": machin_id,
        "style": style,
        "target_qty": target_qty,
        "hour_target": hour_target,
        "date": on_date.isoformat(),
        "floor": floor,
        "line": line_no,
        "layout_id": layout_id,
        "styles": styles,
    }


def _post_day_sew_target_response(row: SewingLog, target: dict) -> dict:
    """Merge saved sewing_log row + daily target for IoT POST confirmation."""
    return {
        "message": "Created",
        "last_insert_id": row.id,
        **_serialize_row(row),
        **target,
    }


def _parse_post_payload(request) -> dict:
    """Accept JSON body even when IoT clients omit Content-Type."""
    body = request.body or b""
    if body:
        text = body.decode("utf-8", errors="ignore").strip()
        if text.startswith("{"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

    data = request.data
    if hasattr(data, "dict"):
        return data.dict()
    return dict(data) if isinstance(data, dict) else {}


class DaySewTargetView(APIView):
    """GET/POST /api/automation/day_sew_target/ — daily target for a machine."""

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        machin_raw = (request.query_params.get("machin_id") or "").strip()
        if machin_raw:
            try:
                machin_id = int(machin_raw)
            except (TypeError, ValueError):
                return Response({"detail": "Invalid machin_id."}, status=400)
            on_date = _parse_on_date(request.query_params.get("date"))
            try:
                payload = _resolve_day_sew_target(machin_id, on_date)
            except Exception as exc:
                return Response(
                    {"detail": "Failed to resolve daily target.", "error": str(exc)},
                    status=503,
                )
            return Response(payload)

        return Response(
            {
                "status": "ok",
                **day_sew_target_urls(),
                "endpoint": "/api/automation/day_sew_target/",
                "methods": ["GET", "POST"],
                "auth": "DEBUG mode: no key required. Production: X-API-Key header, ?api_key=, or api_key in JSON.",
                "get_params": {
                    "machin_id": "required for target lookup",
                    "date": "optional YYYY-MM-DD (default today)",
                },
                "post_fields": {
                    "machin_id": "required — also stores a sewing_log scan row",
                    "logged_at": "optional ISO datetime",
                },
                "get_example": day_sew_target_urls()["get_url"],
                "post_example": {"machin_id": 1122, "logged_at": "2026-07-01T10:00:00"},
                "response_example": {
                    "message": "Created",
                    "last_insert_id": 1587,
                    "id": 1587,
                    "machin_id": 1122,
                    "machin_user": "",
                    "logged_at": "2026-07-01T10:00:00+00:00",
                    "flag1": 0,
                    "flag2": 0,
                    "flag3": 0,
                    "style": "5565-XYZ",
                    "target_qty": 950,
                    "hour_target": 95,
                    "date": "2026-07-01",
                    "floor": 1,
                    "line": 2,
                    "layout_id": 10,
                },
            }
        )

    def post(self, request):
        serializer = DaySewTargetInputSerializer(data=_parse_post_payload(request))
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        machin_id = serializer.validated_data["machin_id"]

        from mbm_automation.iotdatastore_views import _factory_wall_now

        now = timezone.now()
        logged_at = serializer.validated_data.get("logged_at") or _factory_wall_now()
        if timezone.is_naive(logged_at):
            logged_at = timezone.make_aware(logged_at)
        on_date = _sewing_log_on_date(logged_at)

        try:
            row = SewingLog.objects.create(
                machin_id=machin_id,
                machin_user="",
                logged_at=logged_at,
                created_at=now,
                updated_at=now,
            )
            target = _resolve_day_sew_target(machin_id, on_date)
        except Exception as exc:
            return Response(
                {"detail": "Failed to store scan or resolve daily target.", "error": str(exc)},
                status=503,
            )
        return Response(
            _post_day_sew_target_response(row, target),
            status=status.HTTP_201_CREATED,
        )
