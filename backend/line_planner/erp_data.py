"""Live ERP data for the Sewing Line Layout Planner.

Reads the real operation breakdown from ``mbm_ie`` (joined with ``cuttingedgedb``
masters) and the active machine list from ``mbm_automation.line_layout``. All
three schemas live on the same MySQL server, so every query runs on the
``mbm_automation`` connection with fully-qualified ``schema.table`` names.

Read-only: nothing here creates or needs a local table, so the planner works
against the live database without a migration.
"""

from collections import defaultdict

from django.db import connections

_CONN = "mbm_automation"


def _rows(sql, params=None):
    with connections[_CONN].cursor() as cur:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


# ---------------------------------------------------------------- OB masters

_STYLE_SQL = """
SELECT obm.id              AS obm_id,
       obm.style_id,
       obm.line_id,
       obm.hr_unit_id,
       obm.efficiency,
       obm.planed_working_hour,
       obm.no_of_operator,
       obm.no_of_helper,
       obm.total_manpower,
       obm.machine_smv,
       obm.manual_smv,
       obm.total_smv,
       obm.planed_target,
       obm.pitch_time,
       obm.order_qty,
       s.stl_no,
       se.se_name,
       b.b_name           AS buyer_name,
       l.hr_line_name,
       l.hr_line_floor_id AS floor_id,
       f.hr_floor_name,
       u.hr_unit_short_name AS unit_name
FROM mbm_ie.operation_breakdown_master AS obm
JOIN cuttingedgedb.mr_style  AS s  ON obm.style_id   = s.stl_id
LEFT JOIN cuttingedgedb.mr_season AS se ON s.mr_season_Se_id = se.se_id
JOIN cuttingedgedb.mr_buyer  AS b  ON obm.buyer_id   = b.b_id
JOIN cuttingedgedb.hr_line   AS l  ON obm.line_id    = l.hr_line_id
JOIN cuttingedgedb.hr_floor  AS f  ON l.hr_line_floor_id = f.hr_floor_id
JOIN cuttingedgedb.hr_unit   AS u  ON obm.hr_unit_id = u.hr_unit_id
{where}
ORDER BY obm.id DESC
"""


def list_styles() -> list[dict]:
    """Every OB master (one per style+line) the planner can pick from."""
    return _rows(_STYLE_SQL.format(where=""))


def get_style(obm_id: int) -> dict | None:
    rows = _rows(_STYLE_SQL.format(where="WHERE obm.id = %s"), [obm_id])
    return rows[0] if rows else None


# ---------------------------------------------------------------- OB children

_OB_SQL = """
SELECT obc.id,
       obc.part_id,
       obc.operation_id,
       obc.mc_id,
       obc.smv,
       obc.tgt_per_hr,
       obc.op,
       obc.hp,
       obc.remarks,
       opl.name AS part_name,
       ol.operation_name,
       ml.machine_short_name AS machine_name,
       pf.name AS pf_name,
       fo.name AS folder_name,
       g.name  AS guide_name
FROM mbm_ie.operation_breakdown_child AS obc
JOIN mbm_ie.operation_part_list  AS opl ON obc.part_id      = opl.id
JOIN mbm_ie.operation_libraries  AS ol  ON obc.operation_id = ol.id
JOIN mbm_ie.machine_library      AS ml  ON obc.mc_id        = ml.id
LEFT JOIN mbm_ie.pressure_foots  AS pf  ON pf.id = obc.pf_id
LEFT JOIN mbm_ie.folders         AS fo  ON fo.id = obc.folder_id
LEFT JOIN mbm_ie.guides          AS g   ON g.id  = obc.guide_id
WHERE obc.obm_id = %s
ORDER BY obc.id ASC
"""


def ob_rows(obm_id: int) -> list[dict]:
    return _rows(_OB_SQL, [obm_id])


def ob_operations(obm_id: int) -> list[dict]:
    """OB children mapped to the balancer's operation dicts (seq-ordered)."""
    out = []
    for i, r in enumerate(ob_rows(obm_id), start=1):
        attachment = r.get("folder_name") or r.get("guide_name") or r.get("pf_name") or ""
        out.append(
            {
                "id": r["id"],
                "operation_id": r.get("operation_id"),
                "seq": i,
                "operation_name": (r.get("operation_name") or "").strip(),
                "part_name": (r.get("part_name") or "").strip(),
                "machine_type": (r.get("machine_name") or "").strip(),
                "smv": float(r.get("smv") or 0),
                "section": (r.get("part_name") or "").strip(),
                "attachment": attachment,
            }
        )
    return out


# ---------------------------------------------------------------- machines

def _machine_rows(where="", params=None) -> list[dict]:
    sql = (
        "SELECT id, machin_no, machin_name, floor, line_no, unit_id "
        "FROM line_layout " + where + " ORDER BY line_no, machin_no"
    )
    return _rows(sql, params)


def _norm(row) -> dict:
    return {
        "id": row["id"],
        "machine_no": str(row["machin_no"]),
        "machine_type": (row["machin_name"] or "").strip(),
        "line_no": row["line_no"],
        "floor": row["floor"],
        "status": "Idle",  # line_layout carries no status; treat as available
    }


def line_machines(line_no: int, floor=None) -> list[dict]:
    """Active machines on one line, from mbm_automation.line_layout."""
    where = "WHERE line_no = %s"
    params = [line_no]
    if floor is not None:
        where += " AND floor = %s"
        params.append(floor)
    return [_norm(r) for r in _machine_rows(where, params)]


def all_machines() -> list[dict]:
    return [_norm(r) for r in _machine_rows()]


def available_lines() -> list[dict]:
    rows = _rows(
        "SELECT line_no, floor, COUNT(*) AS machines FROM line_layout "
        "GROUP BY line_no, floor ORDER BY line_no"
    )
    return rows


# ---------------------------------------------------------------- operator slots

def operator_slots(stations: list[dict]) -> list[dict]:
    """Expand balanced stations into one slot per operator (= manpower).

    A station with ``operator_count`` N becomes N operator cards that share the
    same operation(s) and machine type, so the floor view shows exactly as many
    positions as the manpower entered and each one can be assigned its own
    machine.
    """
    slots: list[dict] = []
    n = 0
    for st in stations:
        count = max(1, int(st.get("operator_count") or 1))
        for k in range(count):
            n += 1
            slots.append(
                {
                    "slot_no": n,
                    "station_no": st.get("station_no"),
                    "sub_index": k + 1,            # k-th operator of this station
                    "operator_count": count,       # operators sharing the station
                    "machine_type": st.get("machine_type"),
                    "operations": st.get("operations"),
                    "smv_load": st.get("smv_load"),
                    "smv_total": st.get("smv_total"),
                    "row": st.get("row"),
                    "side": st.get("side"),
                    "is_bottleneck": st.get("is_bottleneck"),
                }
            )
    return slots


# ---------------------------------------------------------------- assignment

def assign_machines(line_no: int, stations: list[dict], floor=None) -> dict:
    """Give each station a machine of its type from this line's live library.

    Matches machine type (case-insensitive) against line_layout machines on the
    line; when the line is short of a type, borrows one of that type from
    another line (transfer suggestion). Stations still unmatched are flagged
    ``machine_missing``.
    """
    mine = line_machines(line_no, floor)
    others = [m for m in all_machines() if str(m["line_no"]) != str(line_no)]

    by_type: dict[str, list] = defaultdict(list)
    for m in mine:
        by_type[m["machine_type"].upper()].append(m)
    other_by_type: dict[str, list] = defaultdict(list)
    for m in others:
        other_by_type[m["machine_type"].upper()].append(m)

    used: set[str] = set()
    out_stations, transfers = [], []
    for st in stations:
        code = (st.get("machine_type") or "").strip().upper()
        machine_no = machine_id = transfer = None
        missing = False

        chosen = next((m for m in by_type.get(code, []) if m["machine_no"] not in used), None)
        if chosen is None:
            borrow = next(
                (m for m in other_by_type.get(code, []) if m["machine_no"] not in used), None
            )
            if borrow is not None:
                chosen = borrow
                transfer = {"machine_no": borrow["machine_no"], "from_line": borrow["line_no"]}
                transfers.append(
                    {
                        "station_no": st.get("station_no"),
                        "slot_no": st.get("slot_no"),
                        **transfer,
                    }
                )
        if chosen is not None:
            used.add(chosen["machine_no"])
            machine_no, machine_id = chosen["machine_no"], chosen["id"]
        else:
            missing = True

        out_stations.append(
            {**st, "machine_no": machine_no, "machine_id": machine_id,
             "transfer": transfer, "machine_missing": missing}
        )
    return {"stations": out_stations, "transfers": transfers}


def available_machines(line_no: int, machine_type: str, exclude=None, floor=None) -> list[dict]:
    """Machines for the per-station change dropdown: this line's machines first
    (matching type flagged), then same-type machines on other lines."""
    exclude = {str(x) for x in (exclude or [])}
    code = (machine_type or "").strip().upper()
    mine = line_machines(line_no, floor)
    out = []
    for m in mine:
        if m["machine_no"] in exclude:
            continue
        out.append({**m, "same_line": True, "type_match": m["machine_type"].upper() == code})
    for m in all_machines():
        if str(m["line_no"]) == str(line_no) or m["machine_no"] in exclude:
            continue
        if m["machine_type"].upper() == code:
            out.append({**m, "same_line": False, "type_match": True})
    return out
