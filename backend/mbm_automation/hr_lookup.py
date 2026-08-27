"""Resolve operator name & photo from cuttingedgedb.hr_as_basic_info."""

from __future__ import annotations

from typing import Any

from django.db.models import Q

from core.env import config
from mbm_automation.hr_models import HrAsBasicInfo, HrDesignation

HR_DB = "cuttingedge"
DEFAULT_HR_PHOTO_BASE = "https://erp.mbm.group"


def build_hr_photo_path(as_pic: str | None) -> str | None:
    """Relative path for SPA (/assets/...) — works with Vite/nginx proxy."""
    if not as_pic or not str(as_pic).strip():
        return None
    pic = str(as_pic).strip()
    if pic.startswith("http://") or pic.startswith("https://"):
        from urllib.parse import urlparse

        path = urlparse(pic).path
        return path or None
    return pic if pic.startswith("/") else f"/{pic}"


def build_hr_photo_url(as_pic: str | None) -> str | None:
    """Build full photo URL: https://erp.mbm.group + hr_as_basic_info.as_pic"""
    path = build_hr_photo_path(as_pic)
    if not path:
        return None
    base = config("HR_PHOTO_BASE_URL", default=DEFAULT_HR_PHOTO_BASE).rstrip("/")
    if not base:
        return path
    return f"{base}{path}"


def _active_hr_qs():
    return HrAsBasicInfo.objects.using(HR_DB).filter(deleted_at__isnull=True)


def _designation_name(designation_id: int | None) -> str:
    if not designation_id:
        return "—"
    row = (
        HrDesignation.objects.using(HR_DB)
        .filter(hr_designation_id=designation_id, deleted_at__isnull=True, hr_designation_status=1)
        .only("hr_designation_name", "designation_short_name")
        .first()
    )
    if not row:
        return "—"
    name = (row.hr_designation_name or row.designation_short_name or "").strip()
    return name or "—"


def _profile_from_row(row: HrAsBasicInfo) -> dict[str, Any]:
    return {
        "operator_name": (row.as_name or "").strip() or "—",
        "operator_designation": _designation_name(row.as_designation_id),
        "operator_photo_url": build_hr_photo_url(row.as_pic),
        "hr_associate_id": row.associate_id or "",
        "hr_temp_id": row.temp_id or "",
        "hr_designation_id": row.as_designation_id,
    }


# HR identities change rarely — cache lookups for 10 min so device scans do
# not repeat the (remote, slow) cuttingedgedb query several times per request.
_HR_PROFILE_CACHE: dict[str, tuple[float, dict[str, Any] | None]] = {}
_HR_PROFILE_TTL_SECONDS = 600.0


def lookup_hr_profile(machin_user: str) -> dict[str, Any] | None:
    uid = (machin_user or "").strip()
    if not uid:
        return None

    import time as _time

    hit = _HR_PROFILE_CACHE.get(uid)
    if hit is not None and (_time.time() - hit[0]) < _HR_PROFILE_TTL_SECONDS:
        return hit[1]
    profile = _lookup_hr_profile_uncached(uid)
    _HR_PROFILE_CACHE[uid] = (_time.time(), profile)
    if len(_HR_PROFILE_CACHE) > 5000:
        _HR_PROFILE_CACHE.clear()
    return profile


def _lookup_hr_profile_uncached(uid: str) -> dict[str, Any] | None:
    qs = _active_hr_qs()
    row = (
        qs.filter(
            Q(temp_id=uid)
            | Q(associate_id=uid)
            | Q(as_rfid_code=uid)
            | Q(as_rfid_code__startswith=uid)
        )
        .only("as_name", "as_pic", "associate_id", "temp_id", "as_rfid_code", "as_designation_id")
        .first()
    )

    if row is None and uid.isdigit():
        row = (
            qs.filter(worker_id=int(uid))
            .only("as_name", "as_pic", "associate_id", "temp_id", "as_rfid_code", "as_designation_id")
            .first()
        )

    if row is None:
        return None

    return _profile_from_row(row)


def lookup_hr_profiles(machin_users: list[str]) -> dict[str, dict[str, Any]]:
    """Bulk lookup keyed by machin_user (sewing_log.machin_user)."""
    result: dict[str, dict[str, Any]] = {}
    for uid in {u.strip() for u in machin_users if u and str(u).strip()}:
        profile = lookup_hr_profile(uid)
        if profile:
            result[uid] = profile
    return result
