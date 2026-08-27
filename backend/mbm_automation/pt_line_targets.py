"""Line/style daily targets from cuttingedgedb production tables."""

from __future__ import annotations

from datetime import date
from typing import Any

from mbm_automation.hr_models import DailyLineStyleTarget, HrFloor, HrLine, PtSewingDailyLineTarget

HR_DB = "cuttingedge"


def resolve_hr_line_ids(
    floor: int,
    line_no: int,
    *,
    hr_floor_id: int | None = None,
    hr_line_id: int | None = None,
) -> tuple[int | None, int | None]:
    """Map line_layout floor/line_no to ERP hr_floor_id / hr_line_id."""
    if hr_floor_id and hr_line_id:
        return int(hr_floor_id), int(hr_line_id)

    floor_rows = list(
        HrFloor.objects.using(HR_DB)
        .filter(deleted_at__isnull=True, serial=floor)
        .order_by("-hr_floor_active", "-hr_floor_id")
    )
    if not floor_rows:
        return None, None

    for floor_row in floor_rows:
        line_row = (
            HrLine.objects.using(HR_DB)
            .filter(
                deleted_at__isnull=True,
                hr_line_floor_id=floor_row.hr_floor_id,
                serial=line_no,
            )
            .order_by("-hr_line_status", "-hr_line_id")
            .first()
        )
        if line_row is None:
            line_row = (
                HrLine.objects.using(HR_DB)
                .filter(deleted_at__isnull=True, hr_line_floor_id=floor_row.hr_floor_id)
                .filter(hr_line_name__in=[str(line_no), f"L{line_no}", f"Line {line_no}"])
                .order_by("-hr_line_status", "-hr_line_id")
                .first()
            )
        if line_row is not None:
            return floor_row.hr_floor_id, line_row.hr_line_id

    return floor_rows[0].hr_floor_id, None


def lookup_line_style_target(
    hr_floor_id: int | None,
    hr_line_id: int | None,
    on_date: date,
) -> dict[str, Any]:
    """Read line target + style from pt_sewing_daily_line_targets / daily_line_style_targets."""
    empty = {"target": 0, "style": "", "pt_sewing_id": None}
    if not hr_floor_id or not hr_line_id:
        return empty

    pt = (
        PtSewingDailyLineTarget.objects.using(HR_DB)
        .filter(hr_floor_id=hr_floor_id, hr_line_id=hr_line_id, production_date=on_date)
        .order_by("-id")
        .first()
    )
    if pt is None:
        pt = (
            PtSewingDailyLineTarget.objects.using(HR_DB)
            .filter(
                hr_floor_id=hr_floor_id,
                hr_line_id=hr_line_id,
                production_date__lte=on_date,
            )
            .order_by("-production_date", "-id")
            .first()
        )
    if pt is None:
        return empty

    style_row = (
        DailyLineStyleTarget.objects.using(HR_DB)
        .filter(pt_sewing_id=pt.id, deleted_at__isnull=True, production_date=pt.production_date)
        .order_by("-id")
        .first()
    )

    target = int(style_row.target_qty if style_row and style_row.target_qty else pt.target_qty or 0)
    style = (style_row.stl_no if style_row else "").strip()
    return {"target": target, "style": style, "pt_sewing_id": pt.id}
