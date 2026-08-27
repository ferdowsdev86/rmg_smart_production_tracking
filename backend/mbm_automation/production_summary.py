"""Machine production summary from machin_production_count.

achive = SUM(bundle_qty) - SUM(defect + reject)
defect = SUM(defect)
reject = SUM(reject)

Served over HTTP (GET /api/automation/production_summary/) and over MQTT
(topic <machin_id>/<token> → reply on <machin_id>/<token>/response).
"""

from __future__ import annotations

import json
from datetime import date, datetime

from django.db import connections
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.env import config
from floors.camera_data_views import CameraIngestPermission

DEFAULT_SUMMARY_TOKEN = "7a502ab7-ec03-48bb-a9e4-e5ead965c307"


def _summary_row(machin_id: int, on_date: date) -> dict:
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "SELECT COALESCE(SUM(bundle_qty), 0), COALESCE(SUM(defect), 0), "
            "COALESCE(SUM(reject), 0) "
            "FROM machin_production_count WHERE machin_id = %s AND date = %s",
            [machin_id, on_date],
        )
        qty, defect, reject = cursor.fetchone()
    qty, defect, reject = int(qty), int(defect), int(reject)
    return {
        "machin_id": machin_id,
        "date": on_date.isoformat(),
        "achive": max(0, qty - (defect + reject)),
        "defect": defect,
        "reject": reject,
    }


def _summary_by_date(machin_id: int) -> list[dict]:
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "SELECT date, COALESCE(SUM(bundle_qty), 0), COALESCE(SUM(defect), 0), "
            "COALESCE(SUM(reject), 0) "
            "FROM machin_production_count WHERE machin_id = %s "
            "GROUP BY date ORDER BY date DESC LIMIT 60",
            [machin_id],
        )
        rows = cursor.fetchall()
    return [
        {
            "date": d.isoformat() if d else None,
            "achive": max(0, int(q) - (int(df) + int(rj))),
            "defect": int(df),
            "reject": int(rj),
        }
        for d, q, df, rj in rows
    ]


def machine_production_summary(
    machin_id: int, on_date: date | None = None, all_dates: bool = False
) -> dict:
    if all_dates:
        return {"machin_id": machin_id, "dates": _summary_by_date(machin_id)}
    return _summary_row(machin_id, on_date or timezone.localdate())


def publish_machine_summary(machin_id: int, on_date: date | None = None) -> bool:
    """Push the machine's day summary to MQTT <machin_id>/<token>/response.

    Called after every machin_production_count write (scan qty / defect /
    reject) so devices get the fresh numbers without polling. Best effort —
    never raises.
    """
    try:
        if not machin_id or int(machin_id) <= 0:
            return False
        import paho.mqtt.publish as mqtt_publish

        summary = machine_production_summary(int(machin_id), on_date)
        token = config("MQTT_SUMMARY_TOKEN", default=DEFAULT_SUMMARY_TOKEN)
        mqtt_publish.single(
            f"{machin_id}/{token}/response",
            json.dumps(summary),
            qos=1,
            hostname=config("MQTT_HOST", default="mqtt"),
            port=int(config("MQTT_PORT", default="1883")),
        )
        return True
    except Exception:
        return False


def parse_summary_date(raw: str | None) -> date | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    return datetime.strptime(raw, "%Y-%m-%d").date()


class MachineProductionSummaryView(APIView):
    """GET production_summary/?machin_id=2233[&date=YYYY-MM-DD][&all=1]."""

    authentication_classes = []
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        raw_id = (request.query_params.get("machin_id") or "").strip()
        if not raw_id:
            return Response({"detail": "machin_id is required."}, status=400)
        try:
            machin_id = int(raw_id)
        except (TypeError, ValueError):
            return Response({"detail": "Invalid machin_id."}, status=400)

        all_dates = (request.query_params.get("all") or "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        try:
            on_date = parse_summary_date(request.query_params.get("date"))
        except ValueError:
            return Response({"detail": "date must be YYYY-MM-DD."}, status=400)

        return Response(machine_production_summary(machin_id, on_date, all_dates))
