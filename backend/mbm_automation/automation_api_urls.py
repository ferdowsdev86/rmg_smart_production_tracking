"""LAN API base URL for IoT / RFID devices — from .env."""

from __future__ import annotations

from core.env import config


def automation_api_base() -> str:
    base = (config("AUTOMATION_API_BASE_URL", default="") or "").strip()
    if base:
        return base.rstrip("/")
    host = (config("AUTOMATION_API_HOST", default="127.0.0.1") or "").strip()
    port = (config("AUTOMATION_API_PORT", default="8899") or "").strip()
    return f"http://{host}:{port}"


def day_sew_target_urls() -> dict[str, str]:
    base = automation_api_base()
    path = "/api/automation/day_sew_target/"
    return {
        "base_url": base,
        "post_url": f"{base}{path}",
        "get_url": f"{base}{path}?machin_id=1122",
    }


def iotdatastore_urls() -> dict[str, str]:
    base = automation_api_base()
    path = "/api/automation/iotdatastore/"
    return {
        "base_url": base,
        "post_url": f"{base}{path}",
        "get_url": f"{base}{path}?per_page=10",
    }


def daily_sewing_target_urls() -> dict[str, str]:
    base = automation_api_base()
    path = "/api/automation/daily_sewing_target/"
    return {
        "base_url": base,
        "post_url": f"{base}{path}",
        "get_url": f"{base}{path}?machin_id=2233",
    }
