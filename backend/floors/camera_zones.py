"""Zone → RTSP camera mapping for per-zone live view.

A zone groups one or more workstation ids and points them at a dedicated
RTSP camera. Zones are configured via .env, e.g.::

    CAMERA_ZONE_1_STATIONS=1,2,3,4
    CAMERA_ZONE_1_RTSP_URL=rtsp://user:pass@host:554/Streaming/tracks/101

Stations that do not belong to any zone fall back to the global
CAMERA_RTSP_LIVE_URL (see floors.camera_live.get_configured_rtsp_url).
"""

from __future__ import annotations

from typing import Any

from core.env import config

# Upper bound on how many CAMERA_ZONE_<N>_* slots we probe in .env.
_MAX_ZONES = 32


def _parse_station_ids(raw: str) -> set[str]:
    ids: set[str] = set()
    for part in (raw or "").replace(";", ",").split(","):
        token = part.strip()
        if token:
            ids.add(token)
    return ids


def load_zone_camera_map() -> list[dict[str, Any]]:
    """Read CAMERA_ZONE_<N>_STATIONS / CAMERA_ZONE_<N>_RTSP_URL from env."""
    zones: list[dict[str, Any]] = []
    for n in range(1, _MAX_ZONES + 1):
        url = (config(f"CAMERA_ZONE_{n}_RTSP_URL", default="") or "").strip()
        stations_raw = (config(f"CAMERA_ZONE_{n}_STATIONS", default="") or "").strip()
        if not url and not stations_raw:
            continue
        camera_id = (config(f"CAMERA_ZONE_{n}_CAMERA_ID", default="") or "").strip()
        if not camera_id:
            camera_id = f"CAM-{n:02d}"
        zones.append(
            {
                "zone": n,
                "rtsp_url": url,
                "station_ids": _parse_station_ids(stations_raw),
                "camera_id": camera_id,
            }
        )
    return zones


def resolve_zone_for_station(station_id: str) -> dict[str, Any] | None:
    return resolve_zone_for_stations([station_id])


def resolve_zone_for_stations(station_ids: list[str]) -> dict[str, Any] | None:
    """Match a zone if ANY of the given station identifiers is in its list.

    Several identifiers are accepted because a station can be referred to by
    its global workstation id or by the number shown on the dashboard card.
    """
    ids = {str(s).strip() for s in station_ids if s is not None and str(s).strip()}
    if not ids:
        return None
    for zone in load_zone_camera_map():
        if ids & zone["station_ids"]:
            return zone
    return None


def _global_rtsp() -> str:
    # Imported lazily to avoid a circular import (camera_live imports nothing here).
    from floors.camera_live import get_configured_rtsp_url

    return get_configured_rtsp_url()


def resolve_rtsp_for_station(station_id: str) -> tuple[str, int | None]:
    """Return (rtsp_url, zone_number) for a station, falling back to global."""
    return resolve_rtsp_for_stations([station_id])


def resolve_rtsp_for_stations(station_ids: list[str]) -> tuple[str, int | None]:
    zone = resolve_zone_for_stations(station_ids)
    if zone and zone["rtsp_url"]:
        return zone["rtsp_url"], zone["zone"]
    return _global_rtsp(), None


def resolve_rtsp_from_params(
    *, station: str = "", station_no: str = "", zone: str = ""
) -> tuple[str, int | None]:
    """Resolve an RTSP URL from request params (explicit zone wins over station)."""
    zone_param = (zone or "").strip()
    if zone_param:
        for z in load_zone_camera_map():
            if str(z["zone"]) == zone_param and z["rtsp_url"]:
                return z["rtsp_url"], z["zone"]
    # Match by the global workstation id first (precise). Fall back to the
    # displayed station number only when no workstation id was provided, so a
    # per-process display number can't cross-match a different zone.
    station_param = (station or "").strip()
    if station_param:
        return resolve_rtsp_for_stations([station_param])
    station_no_param = (station_no or "").strip()
    if station_no_param:
        return resolve_rtsp_for_stations([station_no_param])
    return _global_rtsp(), None
