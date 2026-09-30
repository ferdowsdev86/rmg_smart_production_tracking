"""IoT sewing_log ingest + trace — mirrors Laravel SewingMachineTraceController."""

from __future__ import annotations

import re
from datetime import date

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.camera_data_views import CameraIngestPermission
from mbm_automation.automation_api_urls import iotdatastore_urls
from mbm_automation.bundle_barcode import (
    add_pulse_production,
    bundle_response_fields,
    flag9_is_empty,
    flag9_is_trackable_barcode,
    normalize_flag9,
    production_achieved_for_machine,
    upsert_machin_production_count,
)
from mbm_automation.models import SewingLog
from mbm_automation.sewing_analysis import _sewing_wall_datetime
from mbm_automation.services import (
    build_sewing_rfid_device_payload,
    _hr_identity_for_machin_user,
    _minimal_rfid_response,
    resolve_active_machin_user,
)

_FILTERABLE = frozenset(
    {
        "id",
        "machin_id",
        "machin_user",
        "logged_at",
        "flag1",
        "flag2",
        "flag3",
        "flag4",
        "flag5",
        "flag6",
        "flag7",
        "flag8",
        "flag9",
        "created_at",
        "updated_at",
    }
)
_RESERVED_QUERY = frozenset(
    {"per_page", "page", "order_by", "direction", "logged_at_from", "logged_at_to", "info"}
)
_FLAG_FIELDS = tuple(f"flag{i}" for i in range(1, 10))
_SAFE_COL = re.compile(r"^[a-zA-Z0-9_]+$")


class FlexibleFlag9Field(serializers.Field):
    """Accept int or string barcode for flag9 (DB varchar)."""

    default_error_messages = {"invalid": "Invalid flag9."}

    def to_internal_value(self, data):
        return normalize_flag9(data)

    def to_representation(self, value):
        return normalize_flag9(value)


class IotDataStoreWriteSerializer(serializers.Serializer):
    machin_id = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    machin_user = serializers.CharField(required=False, allow_blank=True, max_length=128, default="")
    logged_at = serializers.DateTimeField(required=False, allow_null=True)
    flag1 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag2 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag3 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag4 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag5 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag6 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag7 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag8 = serializers.IntegerField(required=False, min_value=0, max_value=255, default=0)
    flag9 = FlexibleFlag9Field(required=False, default="0")


def _serialize_row(row: SewingLog, identity: dict | None = None) -> dict:
    flag3 = int(row.flag3 or 0)
    data = {
        "id": row.id,
        "machin_id": row.machin_id,
        "machin_user": row.machin_user or "",
    }
    # Name + designation are only meaningful on a login row (flag3 == 0); for
    # other rows (e.g. flag3 == 1) we omit them entirely.
    if flag3 == 0:
        ident = identity if identity is not None else _hr_identity_for_machin_user(row.machin_user or "")
        data["employee_name"] = ident["employee_name"]
        data["designation"] = ident["designation"]
    data.update(
        {
            "logged_at": row.logged_at.isoformat() if row.logged_at else None,
            "flag1": row.flag1 or 0,
            "flag2": row.flag2 or 0,
            "flag3": flag3,
            "flag4": row.flag4 or 0,
            "flag5": row.flag5 or 0,
            "flag6": row.flag6 or 0,
            "flag7": row.flag7 or 0,
            "flag8": row.flag8 or 0,
            "flag9": normalize_flag9(row.flag9),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    )
    return data


def _rfid_response_user_for_insert(row: SewingLog, on_date) -> str:
    """
    machin_user for RFID-shaped POST response.

    flag2=1 + flag3=1 (problem / workstation scan): return whoever is currently
    logged in on that machine (latest flag2=0, flag3=1), not the scanning user.
    """
    machin_user = (row.machin_user or "").strip()
    flag2 = int(row.flag2 or 0)
    flag3 = int(row.flag3 or 0)
    if row.machin_id is None:
        return machin_user
    if flag2 == 1 and flag3 == 1:
        active_user = resolve_active_machin_user(int(row.machin_id), on_date)
        if active_user:
            return active_user
    return machin_user


def _factory_wall_now():
    """Server-side timestamp following the sewing_log convention: the value
    stored is the FACTORY wall clock (Asia/Dhaka) carrying a UTC marker.
    Used when an IoT device posts without its own logged_at."""
    from zoneinfo import ZoneInfo

    from django.conf import settings as _settings

    tz = ZoneInfo(getattr(_settings, "SEWING_LOG_TIMEZONE", "Asia/Dhaka") or "Asia/Dhaka")
    wall = timezone.now().astimezone(tz).replace(tzinfo=None)
    return timezone.make_aware(wall, timezone.utc)


def _sewing_log_on_date(logged_at) -> date:
    """Calendar day for sewing_log filters (factory wall clock, not UTC)."""
    from datetime import date as date_cls

    wall = _sewing_wall_datetime(logged_at)
    if wall:
        return wall.date()
    if logged_at:
        dt = logged_at if timezone.is_aware(logged_at) else timezone.make_aware(logged_at)
        return timezone.localtime(dt).date()
    return timezone.localdate()


def _find_existing_barcode_scan(machin_id: int | None, barcode: str) -> SewingLog | None:
    """Same station + same barcode already captured once."""
    if machin_id is None or not flag9_is_trackable_barcode(barcode):
        return None
    return (
        SewingLog.objects.filter(machin_id=machin_id, flag9=normalize_flag9(barcode))
        .order_by("id")
        .first()
    )


def _attach_bundle_fields(body: dict, flag9, *, keep_day_production: bool) -> dict:
    if flag9_is_empty(flag9):
        return body
    bundle_fields = bundle_response_fields(flag9)
    scan_qty = int(bundle_fields.get("qty") or 0)
    for key, value in bundle_fields.items():
        if key == "production" and keep_day_production:
            continue
        body[key] = value
    body["qty"] = scan_qty
    if not keep_day_production:
        body["production"] = scan_qty
    return body


def _post_insert_response(row: SewingLog, *, response_user: str, rfid_payload: dict | None) -> dict:
    """Merge saved row + RFID device metrics for IoT POST confirmation."""
    uid = (response_user or (row.machin_user or "")).strip()
    identity = _hr_identity_for_machin_user(uid) if int(row.flag3 or 0) == 0 else None
    body: dict = {
        "message": "Created",
        "status": "created",
        "last_insert_id": row.id,
        **_serialize_row(row, identity),
    }
    if rfid_payload:
        body.update(rfid_payload)
    elif row.machin_id is not None and uid:
        body.update(_minimal_rfid_response(int(row.machin_id), uid))

    # flag9 barcode → production qty from bundle_cut_slips (replaces legacy +1).
    body = _attach_bundle_fields(
        body,
        row.flag9,
        keep_day_production=rfid_payload is not None and "production" in body,
    )
    # Day achievement now comes from machin_production_count (SUM(bundle_qty)
    # per date + machine + floor + line).
    if row.machin_id is not None:
        body["production"] = production_achieved_for_machine(
            int(row.machin_id), _sewing_log_on_date(row.logged_at)
        )
    return body


def _detected_barcode_response(existing: SewingLog, payload: dict) -> dict:
    """Second scan of same barcode on same station — no new row, but respond
    with the same live RFID metrics as a normal insert (real present_status,
    not a hardcoded InActive)."""
    uid = (existing.machin_user or payload.get("machin_user") or "").strip()
    identity = (
        _hr_identity_for_machin_user(uid) if int(existing.flag3 or 0) == 0 else None
    )
    body: dict = {
        "message": "Detected",
        "status": "detected",
        "detail": "This barcode was already captured on this station.",
        "last_insert_id": existing.id,
        **_serialize_row(existing, identity),
    }

    rfid_payload = None
    if existing.machin_id is not None and uid:
        on_date = _sewing_log_on_date(timezone.now())
        # Mirror the insert path: metrics follow the CURRENT scanner (payload
        # user), falling back to the original row's user; flag2=1+flag3=1
        # swaps to the machine's active logged-in user.
        response_user = (payload.get("machin_user") or "").strip() or uid
        if int(payload.get("flag2") or 0) == 1 and int(payload.get("flag3") or 0) == 1:
            active_user = resolve_active_machin_user(int(existing.machin_id), on_date)
            if active_user:
                response_user = active_user
        rfid_payload = build_sewing_rfid_device_payload(
            machin_id=int(existing.machin_id),
            machin_user=response_user,
            on_date=on_date,
        )
        if rfid_payload is not None:
            rfid_identity = _hr_identity_for_machin_user(response_user)
            rfid_payload["employee_name"] = rfid_identity["employee_name"]
            rfid_payload["designation"] = rfid_identity["designation"]
            body.update(rfid_payload)
        else:
            body.update(_minimal_rfid_response(int(existing.machin_id), uid))
    body = _attach_bundle_fields(
        body,
        existing.flag9,
        keep_day_production=rfid_payload is not None and "production" in body,
    )
    # Day achievement from machin_production_count (same rule as insert path).
    if existing.machin_id is not None:
        body["production"] = production_achieved_for_machine(
            int(existing.machin_id), _sewing_log_on_date(timezone.now())
        )
    return body


class IotDataStoreView(APIView):
    """
    GET  /api/automation/iotdatastore/ — paginated sewing_log rows (filterable).
    POST /api/automation/iotdatastore/ — insert one sewing_log trace row.
    """

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        if (request.query_params.get("info") or "").strip().lower() in {"1", "true", "yes"}:
            return Response(
                {
                    "message": "IoT sewing_log ingest + list API",
                    **iotdatastore_urls(),
                    "post_body_example": {
                        "machin_id": 1122,
                        "machin_user": "EMP001",
                        "flag1": 0,
                        "flag2": 0,
                        "flag3": 1,
                        "flag9": "260111720694",
                    },
                    "flag9_note": (
                        "When flag9 is not 0/null, it is treated as bundle_cut_slips.barcode; "
                        "response qty/production comes from bundle_cut_shade.qty (not +1). "
                        "Same machin_id + barcode can be captured only once; 2nd POST returns status=detected."
                    ),
                }
            )

        per_page = int(request.query_params.get("per_page") or 100)
        per_page = per_page if 0 < per_page <= 500 else 100
        page = max(1, int(request.query_params.get("page") or 1))

        query = SewingLog.objects.all()

        for key, value in request.query_params.items():
            if key in _RESERVED_QUERY or value in (None, ""):
                continue
            if key not in _FILTERABLE or not _SAFE_COL.match(key):
                continue
            query = query.filter(**{key: value})

        logged_at_from = (request.query_params.get("logged_at_from") or "").strip()
        logged_at_to = (request.query_params.get("logged_at_to") or "").strip()
        if logged_at_from:
            query = query.filter(logged_at__date__gte=logged_at_from)
        if logged_at_to:
            query = query.filter(logged_at__date__lte=logged_at_to)

        order_by = (request.query_params.get("order_by") or "id").strip()
        if order_by not in _FILTERABLE or not _SAFE_COL.match(order_by):
            order_by = "id"
        direction = (request.query_params.get("direction") or "desc").strip().lower()
        order_expr = order_by if direction == "asc" else f"-{order_by}"
        query = query.order_by(order_expr)

        total = query.count()
        offset = (page - 1) * per_page
        rows = list(query[offset : offset + per_page])
        last_page = max(1, (total + per_page - 1) // per_page)

        # Resolve employee_name/designation once per distinct machin_user.
        identity_cache: dict[str, dict] = {}

        def _identity_for(machin_user: str) -> dict:
            uid = (machin_user or "").strip()
            if uid not in identity_cache:
                identity_cache[uid] = _hr_identity_for_machin_user(uid)
            return identity_cache[uid]

        data_rows = [
            _serialize_row(
                row,
                _identity_for(row.machin_user) if int(row.flag3 or 0) == 0 else None,
            )
            for row in rows
        ]

        response_body = {
            "current_page": page,
            "data": data_rows,
            "from": offset + 1 if total else None,
            "last_page": last_page,
            "per_page": per_page,
            "to": offset + len(rows) if total else None,
            "total": total,
        }

        machin_id_raw = (request.query_params.get("machin_id") or "").strip()
        machin_user_raw = (request.query_params.get("machin_user") or "").strip()
        date_str = (request.query_params.get("date") or "").strip()
        if not date_str and logged_at_from and logged_at_from == logged_at_to:
            date_str = logged_at_from

        if machin_id_raw and machin_user_raw and date_str:
            from datetime import datetime

            try:
                on_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                machin_id = int(machin_id_raw)
                rfid_payload = build_sewing_rfid_device_payload(
                    machin_id=machin_id,
                    machin_user=machin_user_raw,
                    on_date=on_date,
                )
                if rfid_payload:
                    identity = _hr_identity_for_machin_user(machin_user_raw)
                    response_body.update(
                        {
                            "machin_id": rfid_payload["machin_id"],
                            "machin_user": rfid_payload["machin_user"],
                            "employee_name": identity["employee_name"],
                            "designation": identity["designation"],
                            "present_status": rfid_payload["present_status"],
                        }
                    )
                else:
                    response_body.update(_minimal_rfid_response(machin_id, machin_user_raw))
            except (ValueError, TypeError):
                pass

        return Response(response_body)

    def post(self, request):
        serializer = IotDataStoreWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        flag9 = normalize_flag9(payload.get("flag9"))
        machin_id = payload.get("machin_id")
        # One barcode per station: 2nd capture returns detected (no new row).
        if flag9_is_trackable_barcode(flag9):
            existing = _find_existing_barcode_scan(machin_id, flag9)
            if existing is not None:
                return Response(
                    _detected_barcode_response(existing, payload),
                    status=status.HTTP_200_OK,
                )

        now = timezone.now()
        # Device clock missing → stamp with factory wall time (Asia/Dhaka),
        # matching the convention that logged_at is the factory wall clock.
        logged_at = payload.get("logged_at") or _factory_wall_now()
        create_kwargs = {
            "machin_id": machin_id,
            "machin_user": payload.get("machin_user") or "",
            "logged_at": logged_at,
            "created_at": now,
            "updated_at": now,
        }
        for flag in _FLAG_FIELDS:
            if flag == "flag9":
                create_kwargs[flag] = flag9
            else:
                create_kwargs[flag] = int(payload.get(flag) or 0)

        try:
            row = SewingLog.objects.create(**create_kwargs)
        except Exception as exc:
            return Response(
                {
                    "message": "Insert failed",
                    "error": str(exc),
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Mirror capture into machin_production_count (best effort — never
        # blocks the device response). Barcode → bundle qty; legacy flag9=1
        # pulse → +1 piece.
        if row.machin_id is not None:
            if flag9_is_trackable_barcode(flag9):
                upsert_machin_production_count(
                    machin_id=int(row.machin_id),
                    barcode=flag9,
                    on_date=_sewing_log_on_date(row.logged_at),
                )
            elif flag9 == "1":
                add_pulse_production(
                    int(row.machin_id), _sewing_log_on_date(row.logged_at)
                )

        # Station login / scan changes → refresh live boards (presence + KPIs).
        try:
            from mbm_automation.board_notify import notify_sewing_board

            notify_sewing_board(
                reason="iot_scan",
                machin_id=int(row.machin_id) if row.machin_id else None,
                on_date=_sewing_log_on_date(row.logged_at) if row.logged_at else None,
            )
        except Exception:
            pass

        machin_id = row.machin_id
        machin_user = (row.machin_user or "").strip()
        if machin_id is None or not machin_user:
            return Response(
                _post_insert_response(row, response_user=machin_user, rfid_payload=None),
                status=status.HTTP_201_CREATED,
            )

        logged_at = row.logged_at or now
        if timezone.is_naive(logged_at):
            logged_at = timezone.make_aware(logged_at)
        on_date = _sewing_log_on_date(logged_at)

        response_user = _rfid_response_user_for_insert(row, on_date)
        rfid_payload = build_sewing_rfid_device_payload(
            machin_id=int(machin_id),
            machin_user=response_user,
            on_date=on_date,
        )
        if rfid_payload is not None:
            identity = _hr_identity_for_machin_user(response_user)
            rfid_payload["employee_name"] = identity["employee_name"]
            rfid_payload["designation"] = identity["designation"]
        return Response(
            _post_insert_response(row, response_user=response_user, rfid_payload=rfid_payload),
            status=status.HTTP_201_CREATED,
        )
