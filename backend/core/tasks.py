import logging

from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer

from floors.services import build_floor_dashboard_payload

logger = logging.getLogger(__name__)


@shared_task
def ping():
    return "pong"


@shared_task
def broadcast_floor_dashboard():
    """Push latest KPI snapshot to WebSocket groups (floor + each line)."""
    payload = build_floor_dashboard_payload()
    channel_layer = get_channel_layer()
    envelope = {"type": "floor.stats", "payload": {"type": "floor.stats", "data": payload}}
    try:
        async_to_sync(channel_layer.group_send)("floor_dashboard", envelope)
    except Exception:
        logger.exception("Failed to broadcast floor dashboard")
    for line in payload.get("lines") or []:
        try:
            async_to_sync(channel_layer.group_send)(
                f"line_{line['id']}",
                {
                    "type": "line.update",
                    "payload": {"type": "line.update", "data": line},
                },
            )
        except Exception:
            logger.exception("Failed to broadcast line %s", line.get("id"))
