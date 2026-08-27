"""HR employee lookup from cuttingedgedb.hr_as_basic_info."""

from __future__ import annotations

from typing import Any

from django.db.models import Q

from mbm_automation.hr_lookup import _active_hr_qs, _designation_name
from mbm_automation.hr_models import HrAsBasicInfo

HR_DB = "cuttingedge"


def hr_employee_key(row: HrAsBasicInfo) -> str:
    return (row.associate_id or "").strip()


def hr_employee_label(row: HrAsBasicInfo) -> str:
    name = (row.as_name or "").strip() or "—"
    associate_id = (row.associate_id or "").strip()
    if associate_id:
        return f"{name} — {associate_id}"
    return name


def list_hr_employees(*, search: str = "", limit: int = 500) -> list[dict[str, Any]]:
    qs = (
        _active_hr_qs()
        .exclude(as_name__isnull=True)
        .exclude(as_name="")
        .exclude(associate_id__isnull=True)
        .exclude(associate_id="")
    )
    term = (search or "").strip()
    if term:
        filters = Q(as_name__icontains=term) | Q(associate_id__icontains=term)
        if term.isdigit():
            filters |= Q(as_id=int(term))
        words = [w for w in term.replace(".", " ").split() if len(w) >= 2]
        if len(words) > 1:
            name_words = Q()
            for word in words:
                name_words &= Q(as_name__icontains=word)
            filters |= name_words
        qs = qs.filter(filters)
    rows = qs.order_by("as_name").only("as_id", "as_name", "associate_id", "as_designation_id")[:limit]
    return [
        {
            "value": (row.associate_id or "").strip(),
            "label": hr_employee_label(row),
            "as_name": (row.as_name or "").strip(),
            "associate_id": (row.associate_id or "").strip(),
        }
        for row in rows
        if (row.associate_id or "").strip()
    ]


def find_hr_row(hr_key: str) -> HrAsBasicInfo | None:
    uid = (hr_key or "").strip()
    if not uid:
        return None
    qs = _active_hr_qs()
    row = (
        qs.filter(associate_id=uid)
        .only(
            "as_id",
            "as_name",
            "associate_id",
            "temp_id",
            "worker_id",
            "as_designation_id",
            "as_pic",
        )
        .first()
    )
    if row:
        return row
    if uid.isdigit():
        row = (
            qs.filter(as_id=int(uid))
            .only(
            "as_id",
            "as_name",
            "associate_id",
            "temp_id",
            "worker_id",
            "as_designation_id",
            "as_pic",
        )
            .first()
        )
        if row:
            return row
    return (
        qs.filter(Q(temp_id=uid) | Q(as_rfid_code=uid))
        .only(
            "as_id",
            "as_name",
            "associate_id",
            "temp_id",
            "worker_id",
            "as_designation_id",
            "as_pic",
        )
        .first()
    )


def validate_associate_id(associate_id: str) -> str:
    uid = (associate_id or "").strip()
    if not uid:
        raise ValueError("Employee is required.")
    row = find_hr_row(uid)
    if row is None:
        raise ValueError(f"HR employee not found for associate_id: {uid}")
    return hr_employee_key(row) or uid


def hr_profile_for_associate_id(associate_id: str) -> dict[str, str]:
    uid = (associate_id or "").strip()
    row = find_hr_row(uid)
    if row is None:
        return {"employee_name": uid or "—", "associate_id": uid}
    return {
        "employee_name": hr_employee_label(row),
        "associate_id": hr_employee_key(row) or uid,
    }
