"""Assign employees to layout process workstations."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Max
from django.utils import timezone

from employees.hr_employee import validate_associate_id
from floors.models import (
    LineLayoutTemplateDetail,
    LineLayoutTemplateDetailWorkstation,
    LineLayoutTemplateMaster,
)


def assignment_counts_for_layout(layout_id: int) -> dict[int, int]:
    rows = (
        LineLayoutTemplateDetailWorkstation.objects.filter(layout_id=layout_id)
        .values("process_id")
        .annotate(count=Count("id"))
    )
    return {int(row["process_id"]): int(row["count"]) for row in rows}


def workstation_offset_for_process(*, layout_id: int, process_id: int) -> int:
    """Cumulative workstation slots from earlier processes on this layout."""
    details = LineLayoutTemplateDetail.objects.filter(master_id=layout_id).order_by(
        "display_order", "id"
    )
    offset = 0
    for detail in details:
        if detail.finishing_process_id == process_id:
            break
        offset += int(detail.no_of_workstation or 0)
    return offset


def list_process_assignments(*, layout_id: int, process_id: int) -> list[dict]:
    rows = (
        LineLayoutTemplateDetailWorkstation.objects.filter(
            layout_id=layout_id,
            process_id=process_id,
        )
        .order_by("workstation_id", "id")
    )
    return [
        {
            "id": row.id,
            "layout_id": row.layout_id,
            "process_id": row.process_id,
            "workstation_id": row.workstation_id,
            "employee_id": row.employee_id,
            "date": row.date.isoformat() if row.date else None,
        }
        for row in rows
    ]


def _next_row_id() -> int:
    current = LineLayoutTemplateDetailWorkstation.objects.aggregate(
        max_id=Max("id")
    )["max_id"]
    return int(current or 0) + 1


@transaction.atomic
def save_process_assignments(
    *,
    layout_id: int,
    process_id: int,
    employee_ids: list[str],
) -> list[dict]:
    master = LineLayoutTemplateMaster.objects.filter(pk=layout_id).first()
    if master is None:
        raise ValueError("Layout not found.")

    detail = LineLayoutTemplateDetail.objects.filter(
        master_id=layout_id,
        finishing_process_id=process_id,
    ).first()
    if detail is None:
        raise ValueError("Process not found on this layout.")

    slot_limit = int(detail.no_of_workstation or 0)
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in employee_ids:
        associate_id = validate_associate_id(raw)
        if associate_id in seen:
            continue
        seen.add(associate_id)
        cleaned.append(associate_id)

    if slot_limit and len(cleaned) > slot_limit:
        raise ValueError(
            f"Cannot assign more than {slot_limit} people for this process."
        )

    target_date = timezone.localdate()
    offset = workstation_offset_for_process(layout_id=layout_id, process_id=process_id)

    LineLayoutTemplateDetailWorkstation.objects.filter(
        layout_id=layout_id,
        process_id=process_id,
    ).delete()

    rows: list[LineLayoutTemplateDetailWorkstation] = []
    next_id = _next_row_id()
    for index, associate_id in enumerate(cleaned):
        rows.append(
            LineLayoutTemplateDetailWorkstation(
                id=next_id,
                layout_id=layout_id,
                process_id=process_id,
                workstation_id=offset + index + 1,
                employee_id=associate_id,
                date=target_date,
            )
        )
        next_id += 1

    if rows:
        LineLayoutTemplateDetailWorkstation.objects.bulk_create(rows)

    return list_process_assignments(layout_id=layout_id, process_id=process_id)
