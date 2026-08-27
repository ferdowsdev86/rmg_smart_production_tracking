"""Resolve linelayouttemplate_master id (layour_id) for station assignments."""

from __future__ import annotations

from datetime import date

from floors.models import LineLayoutTemplateMaster


def resolve_layour_id(*, line_id: int, assigned_date: date) -> int | None:
    exact = (
        LineLayoutTemplateMaster.objects.filter(line_id=line_id, layout_date=assigned_date)
        .order_by("-id")
        .values_list("id", flat=True)
        .first()
    )
    if exact:
        return int(exact)
    fallback = (
        LineLayoutTemplateMaster.objects.filter(line_id=line_id, layout_date__lte=assigned_date)
        .order_by("-layout_date", "-id")
        .values_list("id", flat=True)
        .first()
    )
    return int(fallback) if fallback is not None else None
