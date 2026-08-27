"""MQTT responder: machine production summary over MQTT.

Devices publish anything (optionally {"date": "YYYY-MM-DD"} or {"all": 1})
to  <machin_id>/<token>   e.g. 2233/7a502ab7-ec03-48bb-a9e4-e5ead965c307
and receive the summary JSON on  <machin_id>/<token>/response :

    {"machin_id": 2233, "date": "2026-07-25", "achive": 40, "defect": 1, "reject": 1}

Env: MQTT_HOST (default "mqtt"), MQTT_PORT (1883),
     MQTT_SUMMARY_TOKEN (default 7a502ab7-ec03-48bb-a9e4-e5ead965c307).
"""

from __future__ import annotations

import json
import time

from django.core.management.base import BaseCommand

from core.env import config
from mbm_automation.production_summary import (
    machine_production_summary,
    parse_summary_date,
)

DEFAULT_TOKEN = "7a502ab7-ec03-48bb-a9e4-e5ead965c307"


class Command(BaseCommand):
    help = "Subscribe to <machin_id>/<token> and publish production summary responses."

    def handle(self, *args, **options):
        import paho.mqtt.client as mqtt

        host = config("MQTT_HOST", default="mqtt")
        port = int(config("MQTT_PORT", default="1883"))
        token = config("MQTT_SUMMARY_TOKEN", default=DEFAULT_TOKEN)
        sub_topic = f"+/{token}"

        def on_connect(client, userdata, flags, reason_code, properties=None):
            client.subscribe(sub_topic, qos=1)
            self.stdout.write(f"connected to {host}:{port}, subscribed {sub_topic}")

        def on_message(client, userdata, msg):
            try:
                parts = msg.topic.split("/")
                machin_id = int(parts[0])
            except (ValueError, IndexError):
                return
            on_date = None
            all_dates = False
            if msg.payload:
                try:
                    body = json.loads(msg.payload.decode("utf-8", "ignore"))
                    if isinstance(body, dict):
                        on_date = parse_summary_date(body.get("date"))
                        all_dates = str(body.get("all") or "").lower() in {"1", "true"}
                except (ValueError, TypeError):
                    pass  # non-JSON payload → today's summary
            try:
                summary = machine_production_summary(machin_id, on_date, all_dates)
            except Exception as exc:  # DB hiccup — report instead of dying
                summary = {"machin_id": machin_id, "error": str(exc)}
            client.publish(f"{msg.topic}/response", json.dumps(summary), qos=1)
            self.stdout.write(f"{msg.topic} -> {summary}")

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.on_connect = on_connect
        client.on_message = on_message

        while True:
            try:
                client.connect(host, port, keepalive=30)
                client.loop_forever(retry_first_connection=True)
            except Exception as exc:
                self.stderr.write(f"mqtt connection lost: {exc}; retrying in 5s")
                time.sleep(5)
