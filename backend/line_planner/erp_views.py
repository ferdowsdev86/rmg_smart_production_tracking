"""ERP-live endpoints for the Sewing Line Layout Planner.

Styles + OB come from mbm_ie; machines from mbm_automation.line_layout. These
are read-only against the live DB (no local tables needed).
"""

from datetime import datetime

from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from line_planner import erp_data, layout_store
from line_planner.balancer import balance_line


def _f(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _i(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


@api_view(["GET"])
def erp_styles_view(request):
    """GET /api/line-planner/erp/styles/ — OB masters to pick from."""
    rows = erp_data.list_styles()
    q = (request.query_params.get("search") or "").strip().lower()
    if q:
        rows = [
            r for r in rows
            if q in str(r.get("stl_no") or "").lower()
            or q in str(r.get("buyer_name") or "").lower()
            or q in str(r.get("hr_line_name") or "").lower()
        ]
    return Response({"count": len(rows), "results": rows})


@api_view(["GET"])
def erp_lines_view(request):
    """GET /api/line-planner/erp/lines/ — lines that have machines."""
    return Response(erp_data.available_lines())


@api_view(["GET"])
def erp_machines_view(request):
    """GET /api/line-planner/erp/machines/?line_no=&floor= — a line's machines."""
    p = request.query_params
    line_no = _i(p.get("line_no"))
    if not line_no:
        return Response({"detail": "line_no is required."}, status=400)
    machines = erp_data.line_machines(line_no, _i(p.get("floor")))
    return Response({"count": len(machines), "results": machines})


@api_view(["GET"])
def erp_ob_view(request, obm_id: int):
    """GET /api/line-planner/erp/ob/<obm_id>/ — the style master + operations."""
    style = erp_data.get_style(obm_id)
    if not style:
        return Response({"detail": "OB master not found."}, status=404)
    return Response({"style": style, "operations": erp_data.ob_operations(obm_id)})


@api_view(["POST"])
def erp_generate_view(request):
    """POST /api/line-planner/erp/generate/

    Body: {obm_id, line_no?, floor?, manpower?, target_per_hour?, efficiency?,
    working_hours?, shape?, assign?}. Balances the live OB; when assign=true,
    also assigns machines from line_layout ("Generate and assign").
    """
    d = request.data or {}
    obm_id = _i(d.get("obm_id"))
    if not obm_id:
        return Response({"detail": "obm_id is required."}, status=400)
    style = erp_data.get_style(obm_id)
    if not style:
        return Response({"detail": "OB master not found."}, status=404)

    operations = erp_data.ob_operations(obm_id)
    if not operations:
        return Response({"detail": "This OB has no operations."}, status=400)

    line_no = _i(d.get("line_no"), style.get("line_id"))
    floor = _i(d.get("floor"), style.get("floor_id"))
    # sensible defaults straight from the ERP OB master
    manpower = _i(d.get("manpower"))
    target = _f(d.get("target_per_hour"))
    if not manpower and not target:
        manpower = _i(style.get("total_manpower")) or _i(style.get("no_of_operator"))
    efficiency = _f(d.get("efficiency"))
    if efficiency is None:
        eff = _f(style.get("efficiency"), 60) or 60
        efficiency = eff / 100.0 if eff > 1 else eff
    working_hours = _f(d.get("working_hours"), _f(style.get("planed_working_hour"), 8.0))
    shape = (d.get("shape") or "straight").strip()

    try:
        result = balance_line(
            operations,
            manpower=manpower,
            target_per_hour=target,
            efficiency=efficiency,
            working_hours=working_hours,
            shape=shape,
        )
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    result["style"] = style
    result["line"] = {"line_no": line_no, "floor": floor}
    result["inputs"] = {
        "obm_id": obm_id, "line_no": line_no, "floor": floor, "manpower": manpower,
        "target_per_hour": target, "efficiency": efficiency,
        "working_hours": working_hours, "shape": shape,
    }
    # one card per operator (= manpower), so every operator can be assigned a machine
    operators = erp_data.operator_slots(result["stations"])
    result["transfers"] = []
    if d.get("assign"):
        assigned = erp_data.assign_machines(line_no, operators, floor)
        operators = assigned["stations"]
        result["transfers"] = assigned["transfers"]
    result["operators"] = operators
    return Response(result)


@api_view(["POST"])
def erp_assign_view(request):
    """POST /api/line-planner/erp/assign/  Body: {line_no, floor?, operators:[...]}.

    Assigns one machine per operator slot. Accepts ``operators`` (preferred) or
    legacy ``stations``; returns the assigned slots under both keys.
    """
    d = request.data or {}
    line_no = _i(d.get("line_no"))
    slots = d.get("operators")
    if not isinstance(slots, list):
        slots = d.get("stations")
    if not line_no or not isinstance(slots, list):
        return Response({"detail": "line_no and operators[] are required."}, status=400)
    res = erp_data.assign_machines(line_no, slots, _i(d.get("floor")))
    return Response({"operators": res["stations"], "stations": res["stations"], "transfers": res["transfers"]})


@api_view(["POST"])
def erp_operators_view(request):
    """POST /api/line-planner/erp/operators/

    Body: ``{date?, machine_nos:[...]}`` or, to also get the skill-matrix match,
    ``{date?, machines:[{no, machine_type, operations:[{operation_id, operation_name}]}]}``.

    For the given date, resolves the operator punched into each assigned machine
    (date-wise machine punch record) with name, designation and photo from HR,
    and — when the assigned operations are supplied — the operator's skill-matrix
    fit for that operation (top skill, assigned skill, and a red/yellow/green
    level). Returns a map keyed by machine number.
    """
    # imported lazily so the live-ERP planner has no hard dependency on the
    # sewing-automation app unless this endpoint is actually called
    from mbm_automation.hr_lookup import lookup_hr_profile
    from mbm_automation.sewing_analysis import resolve_active_machin_user
    from mbm_automation.skill_matrix import lookup_skill_profile, match_slot

    d = request.data or {}
    machines = d.get("machines")
    if isinstance(machines, list):
        # normalise {no, machine_type, operations[]} entries
        entries = []
        for m in machines:
            if not isinstance(m, dict):
                continue
            entries.append({
                "no": m.get("no"),
                "machine_type": m.get("machine_type"),
                "operations": m.get("operations") or [],
            })
    else:
        machine_nos = d.get("machine_nos") or []
        if not isinstance(machine_nos, list):
            return Response({"detail": "machine_nos[] or machines[] is required."}, status=400)
        entries = [{"no": n, "machine_type": None, "operations": []} for n in machine_nos]

    date_str = (d.get("date") or "").strip()
    try:
        on_date = (
            datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else timezone.localdate()
        )
    except ValueError:
        on_date = timezone.localdate()

    operators: dict[str, dict | None] = {}
    # resolved operator (uid + hr + skill profile) cached per machine within request
    resolved: dict[int, dict | None] = {}
    for ent in entries:
        raw = ent["no"]
        try:
            machin_id = int(raw)
        except (TypeError, ValueError):
            operators[str(raw)] = None
            continue

        base = resolved.get(machin_id)
        if base is None and machin_id not in resolved:
            uid = resolve_active_machin_user(machin_id, on_date)
            base = None
            if uid:
                hr = lookup_hr_profile(uid) or {}
                base = {
                    "operator_id": uid,
                    "name": hr.get("operator_name") or uid,
                    "designation": hr.get("operator_designation") or "",
                    "photo_url": hr.get("operator_photo_url"),
                    "_profile": lookup_skill_profile(
                        hr.get("hr_associate_id"), hr.get("hr_temp_id")
                    ),
                }
            resolved[machin_id] = base

        if base is None:
            operators[str(raw)] = None
            continue

        profile = base.get("_profile")
        skill = match_slot(profile, ent["operations"], ent.get("machine_type"))
        # efficiency badge: the assigned operation's efficiency, else the avg
        eff = None
        if skill.get("assigned_skill"):
            eff = skill["assigned_skill"].get("efficiency")
        if eff is None and profile:
            eff = profile.get("avg_efficiency")

        operators[str(raw)] = {
            "operator_id": base["operator_id"],
            "name": base["name"],
            "designation": base["designation"],
            "photo_url": base["photo_url"],
            "grade": (profile or {}).get("process_grade"),
            "efficiency": eff,
            "skill": skill,
        }

    return Response({"date": on_date.isoformat(), "operators": operators})


@api_view(["POST"])
def erp_save_layout_view(request):
    """POST /api/line-planner/erp/save-layout/  Body: {result, date}.

    Upserts the master layout (mastar_line_layout) and writes the date-wise
    snapshot (child_line_layout).
    """
    d = request.data or {}
    result = d.get("result")
    if not isinstance(result, dict) or not result.get("operators"):
        return Response({"detail": "result with operators[] is required."}, status=400)
    date_str = (d.get("date") or "").strip()
    try:
        layout_date = (
            datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else timezone.localdate()
        )
    except ValueError:
        layout_date = timezone.localdate()

    user = getattr(request.user, "username", None) or None
    try:
        saved = layout_store.save_layout(result, layout_date=layout_date.isoformat(), user=user)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)
    return Response(saved)


@api_view(["GET"])
def erp_load_layout_view(request):
    """GET /api/line-planner/erp/saved-layout/?obm_id=&line_no=&floor=&date=

    Returns the saved layout (date snapshot if present, else master), or
    {saved: false} when nothing is stored for this style+line.
    """
    p = request.query_params
    obm_id = _i(p.get("obm_id"))
    if not obm_id:
        return Response({"detail": "obm_id is required."}, status=400)
    line_no = _i(p.get("line_no"), 0)
    floor = _i(p.get("floor"), 0)
    date_str = (p.get("date") or "").strip() or None
    found = layout_store.get_layout(obm_id, line_no, floor, date_str)
    if not found:
        return Response({"saved": False})
    return Response({
        "saved": True,
        **found,
        "dates": layout_store.list_saved_dates(obm_id, line_no, floor),
    })


@api_view(["GET"])
def erp_available_machines_view(request):
    """GET /api/line-planner/erp/available-machines/?line_no=&type=&exclude=&floor="""
    p = request.query_params
    line_no = _i(p.get("line_no"))
    code = (p.get("type") or "").strip()
    if not line_no or not code:
        return Response({"detail": "line_no and type are required."}, status=400)
    exclude = [x for x in (p.get("exclude") or "").split(",") if x]
    return Response(
        erp_data.available_machines(line_no, code, exclude=exclude, floor=_i(p.get("floor")))
    )
