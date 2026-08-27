from datetime import datetime

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from floors.services import build_floor_dashboard_payload, build_line_detail_payload


class FloorConsumer(AsyncJsonWebsocketConsumer):
    """Floor-wide KPI snapshots (Celery also pushes every 30s)."""

    group_name = "floor_dashboard"

    async def connect(self):
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        payload = await database_sync_to_async(build_floor_dashboard_payload)()
        await self.send_json({"type": "floor_snapshot", "data": payload})

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def floor_stats(self, event):
        await self.send_json(event.get("payload", {}))


class LineConsumer(AsyncJsonWebsocketConsumer):
    """Line-specific production updates."""

    async def connect(self):
        self.line_id = self.scope["url_route"]["kwargs"]["line_id"]
        self.group_name = f"line_{self.line_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        detail = await database_sync_to_async(build_line_detail_payload)(int(self.line_id))
        if detail:
            await self.send_json({"type": "line_snapshot", "data": detail})

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def line_update(self, event):
        await self.send_json(event.get("payload", {}))


class CameraConsumer(AsyncJsonWebsocketConsumer):
    """Face-detection alerts and status."""

    group_name = "camera_alerts"

    async def connect(self):
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json(
            {
                "type": "camera.connected",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def camera_alert(self, event):
        await self.send_json(event.get("payload", {}))
