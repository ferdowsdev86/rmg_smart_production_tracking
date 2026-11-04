"""Generate and persist balanced layouts."""

from django.db import transaction

from line_planner.assignment import assign_machines
from line_planner.balancer import balance_line
from line_planner.models import Layout, Machine, MachineType, OBOperation, PlannerLine, Station, Style


def _ops_for_style(style: Style) -> list[dict]:
    return [
        {
            "id": o.id,
            "seq": o.seq,
            "operation_name": o.operation_name,
            "machine_type": o.machine_type.code,
            "smv": o.smv,
            "section": o.section,
            "skill_grade": o.skill_grade,
        }
        for o in style.operations.select_related("machine_type").all()
    ]


def generate(style_id, line_id, *, manpower=None, target_per_hour=None, efficiency=0.6, working_hours=8.0, assign=False):
    """Balance a style's OB onto a line; optionally assign machines."""
    style = Style.objects.prefetch_related("operations__machine_type").get(id=style_id)
    line = PlannerLine.objects.get(id=line_id)
    result = balance_line(
        _ops_for_style(style),
        manpower=manpower,
        target_per_hour=target_per_hour,
        efficiency=efficiency,
        working_hours=working_hours,
        shape=line.shape,
    )
    result["style"] = {"id": style.id, "style_no": style.style_no, "style_name": style.style_name, "buyer": style.buyer}
    result["line"] = {"id": line.id, "line_no": line.line_no, "floor": line.floor, "shape": line.shape}
    result["transfers"] = []
    if assign:
        assigned = assign_machines(line.line_no, result["stations"])
        result["stations"] = assigned["stations"]
        result["transfers"] = assigned["transfers"]
    return result


@transaction.atomic
def save_layout(style_id, line_id, inputs, summary, stations) -> Layout:
    """Persist a generated layout as a new version for this style + line."""
    style = Style.objects.get(id=style_id)
    line = PlannerLine.objects.get(id=line_id)
    last = Layout.objects.filter(style=style, line=line).order_by("-version").first()
    version = (last.version + 1) if last else 1

    layout = Layout.objects.create(
        style=style,
        line=line,
        inputs=inputs or {},
        version=version,
        total_smv=summary.get("total_smv", 0) or 0,
        target_per_hour=summary.get("target_per_hour", 0) or 0,
        takt_time=summary.get("takt_time", 0) or 0,
        balance_pct=summary.get("balance_pct", 0) or 0,
        station_count=len(stations),
    )

    type_by_code = {t.code: t for t in MachineType.objects.all()}
    for st in stations:
        station = Station.objects.create(
            layout=layout,
            station_no=st.get("station_no", 0),
            machine_type=type_by_code.get(st.get("machine_type")),
            machine_id=st.get("machine_id"),
            operator_count=st.get("operator_count", 1),
            smv_load=st.get("smv_load", 0) or 0,
            row=st.get("row", "A"),
            side=st.get("side", "") or "",
            position=st.get("position", 0),
        )
        op_ids = [o.get("id") for o in st.get("operations", []) if o.get("id")]
        if op_ids:
            station.operations.set(OBOperation.objects.filter(id__in=op_ids))
    return layout
