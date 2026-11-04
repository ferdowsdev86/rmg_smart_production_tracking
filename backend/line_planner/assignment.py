"""Assign real machine numbers from the library to balanced stations."""

from collections import defaultdict

from line_planner.models import Machine


def assign_machines(line_label: str, stations: list[dict]) -> dict:
    """Give each station a machine of its type from ``line_label``'s library.

    Picks Running/Idle machines on the line, never reusing one. When the line
    is short of a type, suggests borrowing an Idle machine from another line.
    Stations still without a machine are flagged ``machine_missing``.
    """
    used: set[int] = set()
    on_line: dict[str, list] = defaultdict(list)
    elsewhere: dict[str, list] = defaultdict(list)  # idle, other lines

    qs = Machine.objects.filter(
        status__in=[Machine.STATUS_RUNNING, Machine.STATUS_IDLE]
    ).select_related("machine_type")
    for m in qs:
        code = m.machine_type.code
        if (m.current_line or "") == line_label:
            on_line[code].append(m)
        elif m.status == Machine.STATUS_IDLE:
            elsewhere[code].append(m)

    out_stations: list[dict] = []
    transfers: list[dict] = []
    for st in stations:
        code = st.get("machine_type") or ""
        machine_no = None
        machine_id = None
        transfer = None
        missing = False

        chosen = next((m for m in on_line.get(code, []) if m.id not in used), None)
        if chosen is None:
            borrow = next((m for m in elsewhere.get(code, []) if m.id not in used), None)
            if borrow is not None:
                chosen = borrow
                transfer = {"machine_no": borrow.machine_no, "from_line": borrow.current_line}
                transfers.append({"station_no": st.get("station_no"), **transfer})
        if chosen is not None:
            used.add(chosen.id)
            machine_no = chosen.machine_no
            machine_id = chosen.id
        else:
            missing = True

        out_stations.append(
            {
                **st,
                "machine_no": machine_no,
                "machine_id": machine_id,
                "transfer": transfer,
                "machine_missing": missing,
            }
        )

    return {"stations": out_stations, "transfers": transfers}


def available_machines(line_label: str, machine_type_code: str, exclude_ids=None) -> list[dict]:
    """Machines of a type that could go on this line (for the change dropdown)."""
    exclude_ids = set(exclude_ids or [])
    qs = (
        Machine.objects.filter(
            machine_type__code=machine_type_code,
            status__in=[Machine.STATUS_RUNNING, Machine.STATUS_IDLE],
        )
        .select_related("machine_type")
        .order_by("machine_no")
    )
    out = []
    for m in qs:
        if m.id in exclude_ids:
            continue
        out.append(
            {
                "id": m.id,
                "machine_no": m.machine_no,
                "status": m.status,
                "current_line": m.current_line,
                "same_line": (m.current_line or "") == line_label,
            }
        )
    return out
