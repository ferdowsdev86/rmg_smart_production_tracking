"""Push a lightweight refresh ping to sewing / floor live boards.

TV board and floor overview poll as a fallback; this Channels broadcast
makes them refetch as soon as production or quality data changes.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

logger = logging.getLogger(__name__)

SEWING_BOARD_GROUP = "sewing_board"


def notify_sewing_board(
    *,
    reason: str = "update",
    machin_id: int | None = None,
    on_date: date | None = None,
    extra: dict[str, Any] | None = None,
) -> bool:
    """Best-effort broadcast — never raises into API handlers."""
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return False
        payload: dict[str, Any] = {
            "type": "sewing.board_refresh",
            "reason": reason,
            "date": (on_date or timezone.localdate()).isoformat(),
            "machin_id": int(machin_id) if machin_id else None,
        }
        if extra:
            payload.update(extra)
        async_to_sync(channel_layer.group_send)(
            SEWING_BOARD_GROUP,
            {"type": "sewing.board_refresh", "payload": payload},
        )
        return True
    except Exception:
        logger.debug("sewing board notify failed", exc_info=True)
        return False
