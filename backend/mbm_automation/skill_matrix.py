"""Operator skill-matrix lookup + operation match (mbm_ie.skill_matrix_*).

Each employee has a skill-matrix master row and many detail rows (one per
operation they have been graded on, with an efficiency level and earn point).
Given the operation(s) assigned to an operator's machine, we classify the fit:

    green  — the assigned operation IS the operator's top skill
    yellow — the operator has this skill (or a similar one), just not their top
    red    — the operator has no matching skill for this operation

The master joins to HR by ``employee_id`` (= HR associate_id) or ``temp_id``.
Details join ``operation_id`` to ``mbm_ie.operation_libraries`` (the same id the
OB child carries), so the layout's operation lines match directly.
"""

from __future__ import annotations

import re
import time as _time
from typing import Any

from django.db import connections

# same server as cuttingedgedb → cross-schema raw SQL on this connection
_CONN = "cuttingedge"

# words too generic to prove two operation names are "similar"
_STOP = {
    "by", "the", "and", "with", "for", "of", "to", "at", "on", "in",
    "join", "attach", "make", "sew", "stitch", "close", "mark", "set",
    "part", "single", "double", "both", "side", "top", "cut", "tack",
}


def _norm_tokens(name: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    return {w for w in words if len(w) >= 3 and w not in _STOP}


def _to_int(v: Any, default: int | None = None) -> int | None:
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return default


def _rows(sql: str, params: list) -> list[dict]:
    with connections[_CONN].cursor() as cur:
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


_MASTER_SQL = """
SELECT id, average_efficiency, process_grade, pg_id
FROM mbm_ie.skill_matrix_master
WHERE (employee_id = %s AND %s <> '')
   OR (temp_id = %s AND %s <> '')
ORDER BY id DESC
LIMIT 1
"""

_DETAIL_SQL = """
SELECT d.operation_id,
       ol.operation_name,
       d.machine_id,
       ml.machine_short_name AS machine_type,
       d.efficiency_level,
       d.earn_point
FROM mbm_ie.skill_matrix_details AS d
LEFT JOIN mbm_ie.operation_libraries AS ol ON ol.id = d.operation_id
LEFT JOIN mbm_ie.machine_library     AS ml ON ml.id = d.machine_id
WHERE d.master_id = %s
"""

# skill profiles change rarely; cache per operator identity for 10 min
_CACHE: dict[str, tuple[float, dict | None]] = {}
_TTL = 600.0


def lookup_skill_profile(associate_id: str | None, temp_id: Any = None) -> dict | None:
    """Return the operator's skill matrix, or None when they are not graded."""
    assoc = (str(associate_id).strip() if associate_id else "")
    temp = (str(temp_id).strip() if temp_id not in (None, "") else "")
    if not assoc and not temp:
        return None

    key = f"{assoc}|{temp}"
    hit = _CACHE.get(key)
    if hit is not None and (_time.time() - hit[0]) < _TTL:
        return hit[1]

    profile = _lookup_uncached(assoc, temp)
    _CACHE[key] = (_time.time(), profile)
    if len(_CACHE) > 5000:
        _CACHE.clear()
    return profile


def _lookup_uncached(assoc: str, temp: str) -> dict | None:
    master = _rows(_MASTER_SQL, [assoc, assoc, temp, temp])
    if not master:
        return None
    m = master[0]

    skills: list[dict] = []
    for d in _rows(_DETAIL_SQL, [m["id"]]):
        op_id = d.get("operation_id")
        if not op_id:
            continue
        skills.append(
            {
                "operation_id": int(op_id),
                "operation_name": (d.get("operation_name") or "").strip(),
                "machine_type": (d.get("machine_type") or "").strip().upper(),
                "efficiency": _to_int(d.get("efficiency_level")),
                "earn_point": _to_int(d.get("earn_point"), 0) or 0,
            }
        )

    # top skill = highest earn point, tie-break on efficiency
    top = None
    if skills:
        top = max(skills, key=lambda s: (s["earn_point"], s["efficiency"] or 0))

    return {
        "avg_efficiency": _to_int(m.get("average_efficiency")),
        "process_grade": (m.get("process_grade") or "").strip() or None,
        "skills": skills,
        "top": top,
        "_by_op": {s["operation_id"]: s for s in skills},
    }


def match_slot(profile: dict | None, operations, machine_type: str | None = None) -> dict:
    """Classify how well the operator fits the assigned operation(s).

    ``operations`` is a list of ``{operation_id, operation_name, machine_type}``
    (the lines on the operator's machine). Returns
    ``{level, reason, top_skill, assigned_skill, similar}`` where level is one of
    'green' | 'yellow' | 'red' | None (None = operator not graded).
    """
    if not profile:
        return {"level": None, "reason": "ungraded", "top_skill": None,
                "assigned_skill": None, "similar": False}

    ops = []
    for o in operations or []:
        oid = _to_int(o.get("operation_id")) if isinstance(o, dict) else _to_int(o)
        ops.append({
            "operation_id": oid,
            "operation_name": (o.get("operation_name") if isinstance(o, dict) else "") or "",
            "machine_type": ((o.get("machine_type") if isinstance(o, dict) else machine_type) or machine_type or "").strip().upper(),
        })

    by_op = profile.get("_by_op") or {}
    top = profile.get("top")
    top_id = top["operation_id"] if top else None
    top_skill = (
        {"operation_name": top["operation_name"], "machine_type": top["machine_type"],
         "efficiency": top["efficiency"]}
        if top else None
    )

    # 1) exact skill for an assigned operation
    exact = next((by_op[o["operation_id"]] for o in ops if o["operation_id"] in by_op), None)
    is_top = any(o["operation_id"] == top_id for o in ops) and top_id is not None
    if exact is not None:
        level = "green" if is_top else "yellow"
        return {
            "level": level,
            "reason": "top" if is_top else "has",
            "top_skill": top_skill,
            "assigned_skill": {"operation_name": exact["operation_name"], "efficiency": exact["efficiency"]},
            "similar": False,
        }

    # 2) a similar skill: shared operation-name tokens (prefer same machine type)
    similar = None
    similar_score = (0, 0)  # (name-token overlap, same-machine flag)
    for o in ops:
        want = _norm_tokens(o["operation_name"])
        mc = o["machine_type"]
        for s in profile["skills"]:
            overlap = len(want & _norm_tokens(s["operation_name"])) if want else 0
            same_mc = 1 if (mc and s["machine_type"] == mc) else 0
            if overlap == 0 and not same_mc:
                continue
            # require a real name link, or a same-machine skill as a weak hint
            score = (overlap, same_mc)
            if overlap >= 1 or same_mc:
                if score > similar_score:
                    similar_score = score
                    similar = s
    if similar is not None and (similar_score[0] >= 1 or similar_score[1]):
        return {
            "level": "yellow",
            "reason": "similar",
            "top_skill": top_skill,
            "assigned_skill": {"operation_name": similar["operation_name"], "efficiency": similar["efficiency"]},
            "similar": True,
        }

    # 3) no matching skill
    return {"level": "red", "reason": "none", "top_skill": top_skill,
            "assigned_skill": None, "similar": False}
