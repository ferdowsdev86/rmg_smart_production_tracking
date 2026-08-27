"""Ingest API for smartfinishinfloor.camera_data (external camera / edge applications)."""

from __future__ import annotations

import logging
from datetime import datetime, time

from django.conf import settings
from django.db import transaction
from rest_framework import serializers, status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from core.env import config
from floors.models import CameraData

logger = logging.getLogger(__name__)

_RECORD_FIELD_ALIASES = {
    "workstationId": "workstation_id",
    "workstationID": "workstation_id",
    "workstationNo": "workstation_id",
    "employeeId": "employee_id",
    "employeeID": "employee_id",
    "emp_id": "employee_id",
    "empId": "employee_id",
    "inTime": "intime",
    "outTime": "outtime",
    "cameraId": "camera_id",
    "floor_id": "floor",
    "floorId": "floor",
    "floor_no": "floor",
    "floorNo": "floor",
    "line_id": "line",
    "lineId": "line",
    "line_no": "line",
    "lineNo": "line",
}

_REQUIRED_RECORD_FIELDS = ("floor", "line", "workstation_id", "employee_id", "date")


def _parse_time_value(value) -> time | None:
    if value is None or value == "":
        return None
    if isinstance(value, time):
        return value
    raw = str(value).strip()
    if not raw:
        return None

    # Accept full datetime strings from camera apps (use time portion only).
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(raw[:26], fmt).time()
        except ValueError:
            continue

    for fmt in (
        "%H:%M:%S",
        "%H:%M",
        "%I:%M %p",
        "%I:%M%p",
        "%I:%M:%S %p",
        "%H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    raise serializers.ValidationError(f"Invalid time value: {value!r}")


def _normalize_record(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None

    out: dict = {}
    for key, value in raw.items():
        norm_key = _RECORD_FIELD_ALIASES.get(key, key)
        if norm_key in out and out[norm_key] not in (None, ""):
            continue
        out[norm_key] = value

    for field in ("unit", "floor", "line", "workstation_id", "employee_id", "camera_id"):
        if field in out and out[field] is not None:
            out[field] = str(out[field]).strip()

    return out


def _normalize_bulk_payload(payload) -> dict:
    """Accept records[], data[], a raw list, or a single record object."""
    if payload is None:
        return {"records": []}

    if isinstance(payload, list):
        return {"records": [r for item in payload if (r := _normalize_record(item))]}

    if not isinstance(payload, dict):
        return {"records": []}

    records = payload.get("records")
    if records is None:
        records = payload.get("data")
    if records is None:
        records = payload.get("items")
    if records is None and any(
        key in payload
        for key in (
            "floor",
            "line",
            "workstation_id",
            "workstationId",
            "employee_id",
            "employeeId",
            "date",
        )
    ):
        records = [payload]

    if records is None:
        return {"records": []}

    if not isinstance(records, list):
        records = [records]

    return {"records": [r for item in records if (r := _normalize_record(item))]}


def _validation_error_response(errors, *, skipped: list[dict] | None = None) -> Response:
    body = {
        "status": "error",
        "detail": "Invalid camera bulk payload.",
        "errors": errors,
    }
    if skipped:
        body["skipped"] = skipped
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


class CameraDataIngestSerializer(serializers.Serializer):
    unit = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    floor = serializers.CharField(max_length=100)
    line = serializers.CharField(max_length=100)
    workstation_id = serializers.CharField(max_length=50)
    employee_id = serializers.CharField(max_length=50)
    intime = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    outtime = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    camera_id = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    date = serializers.DateField()

    def validate_intime(self, value):
        return _parse_time_value(value)

    def validate_outtime(self, value):
        return _parse_time_value(value)

    def create(self, validated_data) -> CameraData:
        return CameraData.objects.create(**validated_data)


class CameraDataBulkIngestSerializer(serializers.Serializer):
    records = CameraDataIngestSerializer(many=True, allow_empty=False)


class CameraIngestPermission(BasePermission):
    """DEBUG: open for LAN/dev. Production: X-API-Key, ?api_key=, or JSON api_key field."""

    message = "Invalid or missing API key. Send header X-API-Key, ?api_key=, or api_key in JSON body."

    def _extract_api_key(self, request) -> str:
        provided = (request.headers.get("X-API-Key") or "").strip()
        if not provided:
            auth = (request.headers.get("Authorization") or "").strip()
            if auth.lower().startswith("api-key "):
                provided = auth[8:].strip()
        if not provided:
            provided = (request.query_params.get("api_key") or "").strip()
        if not provided and isinstance(request.data, dict):
            provided = str(request.data.get("api_key") or "").strip()
        return provided

    def has_permission(self, request, view) -> bool:
        if settings.DEBUG:
            return True

        if request.user and request.user.is_authenticated:
            return True

        expected = (config("CAMERA_INGEST_API_KEY", default="") or "").strip()
        if not expected:
            return True

        return self._extract_api_key(request) == expected


class CameraDataIngestView(APIView):
    """POST /api/camera/data/ — insert one camera_data row."""

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        return Response(
            {
                "status": "ok",
                "endpoint": "/api/camera/data/",
                "method": "POST",
                "auth": "DEBUG mode: no key required. Production: X-API-Key header, ?api_key=, or api_key in JSON.",
                "example": {
                    "unit": "U1",
                    "floor": "1",
                    "line": "1",
                    "workstation_id": "05",
                    "employee_id": "24K128419N",
                    "intime": "8:06 AM",
                    "outtime": "11:51 PM",
                    "camera_id": "CAM-01",
                    "date": "2026-06-15",
                },
            }
        )

    def post(self, request):
        payload = _normalize_record(request.data)
        if payload is None:
            return _validation_error_response({"detail": "Expected a JSON object."})

        ser = CameraDataIngestSerializer(data=payload)
        if not ser.is_valid():
            logger.warning("camera data ingest validation failed: %s body=%s", ser.errors, request.data)
            return _validation_error_response(ser.errors)

        row = ser.save()
        return Response(
            {
                "status": "created",
                "id": row.id,
                "date": row.date.isoformat(),
                "employee_id": row.employee_id,
                "workstation_id": row.workstation_id,
                "camera_id": row.camera_id,
            },
            status=status.HTTP_201_CREATED,
        )


class CameraDataBulkIngestView(APIView):
    """POST /api/camera/data/bulk/ — insert multiple camera_data rows."""

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        return Response(
            {
                "status": "ok",
                "endpoint": "/api/camera/data/bulk/",
                "method": "POST",
                "auth": "DEBUG mode: no key required. Production: X-API-Key header, ?api_key=, or api_key in JSON.",
                "accepted_shapes": [
                    '{"records":[{...}]}',
                    '{"data":[{...}]}',
                    '[{...}]',
                    '{...} single record',
                ],
                "required_fields": list(_REQUIRED_RECORD_FIELDS),
                "example": {
                    "records": [
                        {
                            "unit": "U1",
                            "floor": "1",
                            "line": "1",
                            "workstation_id": "05",
                            "employee_id": "24K128419N",
                            "intime": "8:06 AM",
                            "outtime": "11:51 PM",
                            "camera_id": "CAM-01",
                            "date": "2026-06-15",
                        }
                    ]
                },
            }
        )

    def post(self, request):
        normalized = _normalize_bulk_payload(request.data)
        records = normalized.get("records") or []

        skipped: list[dict] = []
        ingest_records: list[dict] = []
        for index, record in enumerate(records):
            missing = [field for field in _REQUIRED_RECORD_FIELDS if not (record.get(field) or "").strip()]
            employee_id = (record.get("employee_id") or "").strip()
            if employee_id.upper().startswith("STARTUP"):
                skipped.append(
                    {
                        "index": index,
                        "reason": "employee_id is STARTUP placeholder",
                        "record": record,
                    }
                )
                continue
            if missing:
                skipped.append({"index": index, "reason": f"Missing: {', '.join(missing)}", "record": record})
                continue
            ingest_records.append(record)

        if not ingest_records:
            errors = {
                "records": "No valid records to insert.",
                "hint": "Send records/data array with floor, line, workstation_id, employee_id, date.",
            }
            if not records:
                errors["received"] = request.data
            logger.warning(
                "camera bulk ingest rejected: no valid records. skipped=%s body=%s",
                skipped,
                request.data,
            )
            return _validation_error_response(errors, skipped=skipped or None)

        ser = CameraDataBulkIngestSerializer(data={"records": ingest_records})
        if not ser.is_valid():
            logger.warning(
                "camera bulk ingest validation failed: %s body=%s normalized=%s",
                ser.errors,
                request.data,
                ingest_records,
            )
            return _validation_error_response(ser.errors, skipped=skipped or None)

        created = []
        with transaction.atomic():
            for item in ser.validated_data["records"]:
                row = CameraData.objects.create(**item)
                created.append(
                    {
                        "id": row.id,
                        "date": row.date.isoformat(),
                        "employee_id": row.employee_id,
                        "workstation_id": row.workstation_id,
                        "camera_id": row.camera_id,
                    }
                )

        response_body = {
            "status": "created",
            "count": len(created),
            "records": created,
        }
        if skipped:
            response_body["skipped"] = skipped
            response_body["skipped_count"] = len(skipped)

        return Response(response_body, status=status.HTTP_201_CREATED)
