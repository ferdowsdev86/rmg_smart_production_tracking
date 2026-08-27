"""Helpers for finishing line layout templates (floors_linelayouttemplate)."""

from __future__ import annotations

from typing import Any

from floors.models import FinishingProcess


def normalize_layout_stations(stations: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Keep only process rows from the layout table (station_count > 0)."""
    rows: list[dict[str, Any]] = []
    for item in stations or []:
        if not isinstance(item, dict):
            continue
        count = int(item.get("station_count") or item.get("stationCount") or 0)
        if count <= 0:
            continue
        order = int(item.get("display_order") or item.get("order") or 0)
        rows.append(
            {
                "display_order": order,
                "slug": str(item.get("slug") or item.get("id") or f"process-{order}"),
                "name": str(item.get("name") or ""),
                "station_count": count,
                "code": str(item.get("code") or "ST"),
                "caption": str(item.get("caption") or ""),
            }
        )
    rows.sort(key=lambda r: r["display_order"])
    return rows


def default_finishing_layout_stations() -> list[dict[str, Any]]:
    """Snapshot active finishing_process rows for a new template."""
    rows = []
    for proc in FinishingProcess.objects.filter(is_active=True).order_by("display_order"):
        caption = proc.process_name
        if proc.product_type:
            caption = f"{proc.process_name} · {proc.product_type}"
        rows.append(
            {
                "display_order": proc.display_order,
                "slug": proc.slug,
                "name": proc.process_name,
                "station_count": proc.station_count,
                "code": proc.code,
                "caption": caption,
            }
        )
    return rows
