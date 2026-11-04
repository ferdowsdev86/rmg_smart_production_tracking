"""Pure line-balancing calculation — no Django, no DB.

Kept dependency-free so it can be unit-tested in isolation and mirrored to
JavaScript (frontend/src/lib/lineBalance.js) for live drag-and-drop recalc.

An ``operation`` is a plain dict with at least:
    {"seq": int, "operation_name": str, "machine_type": str, "smv": float}
optionally section / skill_grade / id.

balance_line(...) returns:
    {
      "total_smv", "target_per_hour", "takt_time", "working_hours", "day_target",
      "manpower_used", "station_count", "balance_pct", "bottleneck_station",
      "machine_requirement": {type: count},
      "stations": [ {station_no, machine_type, operations[], operator_count,
                     smv_total, smv_load, row, position, is_bottleneck} ],
    }
"""

from __future__ import annotations

import math
from typing import Optional


def _combine_adjacent(operations: list[dict], takt: float) -> list[dict]:
    """Group adjacent operations with the SAME machine type whose combined SMV
    fits within one takt — i.e. one operator can do them all. Sequence order is
    preserved."""
    groups: list[dict] = []
    current: Optional[dict] = None
    for op in operations:
        mt = op.get("machine_type") or ""
        smv = float(op.get("smv") or 0)
        if (
            current is not None
            and current["machine_type"] == mt
            and current["smv_total"] + smv <= takt + 1e-9
        ):
            current["operations"].append(op)
            current["smv_total"] += smv
        else:
            current = {"machine_type": mt, "operations": [op], "smv_total": smv}
            groups.append(current)
    return groups


def _load(group: dict) -> float:
    """Per-operator cycle time of a station."""
    return group["smv_total"] / max(1, group["operator_count"])


def _balance_to_manpower(groups: list[dict], manpower: int) -> None:
    """Add operators to the most-loaded station / remove from the least-loaded
    until the total operator count equals ``manpower`` (floor = one per
    station)."""
    total = sum(g["operator_count"] for g in groups)

    # add operators where they relieve the most load
    while total < manpower:
        target = max(groups, key=_load)
        target["operator_count"] += 1
        total += 1

    # remove operators from the least-loaded stations that still have spare
    while total > manpower:
        candidates = [g for g in groups if g["operator_count"] > 1]
        if not candidates:
            break  # every station is already at one operator
        target = min(candidates, key=_load)
        target["operator_count"] -= 1
        total -= 1


def _assign_flow(groups: list[dict], shape: str) -> None:
    """Number stations in sequence and lay them out in a snake flow."""
    n = len(groups)
    half = math.ceil(n / 2) if n else 0
    for i, g in enumerate(groups):
        g["station_no"] = i + 1
        g["position"] = i
        if shape == "straight":
            g["row"] = "A" if i < half else "B"
        else:  # u-shape / zig-zag also use two rows, snake back on row B
            g["row"] = "A" if i < half else "B"
        g["side"] = "input" if i == 0 else ("output" if i == n - 1 else "")


def balance_line(
    operations: list[dict],
    *,
    manpower: Optional[int] = None,
    target_per_hour: Optional[float] = None,
    efficiency: float = 0.6,
    working_hours: float = 8.0,
    shape: str = "straight",
) -> dict:
    """Balance an OB into stations. Provide manpower OR target_per_hour."""
    operations = sorted(operations, key=lambda o: o.get("seq", 0))
    total_smv = round(sum(float(o.get("smv") or 0) for o in operations), 4)
    if total_smv <= 0:
        raise ValueError("total SMV must be greater than zero")

    if not target_per_hour or target_per_hour <= 0:
        if not manpower or manpower <= 0:
            raise ValueError("provide either manpower or target_per_hour")
        target_per_hour = manpower * 60.0 * efficiency / total_smv
    target_per_hour = round(target_per_hour, 2)
    takt_time = round(60.0 / target_per_hour, 4)

    groups = _combine_adjacent(operations, takt_time)
    for g in groups:
        g["operator_count"] = max(1, round(g["smv_total"] / takt_time))
    if manpower and manpower > 0:
        _balance_to_manpower(groups, manpower)

    _assign_flow(groups, shape)

    loads = [_load(g) for g in groups] or [0]
    max_load = max(loads) or 1
    balance_pct = round((sum(loads) / len(loads)) / max_load * 100, 1)
    bottleneck_no = max(groups, key=_load)["station_no"] if groups else None

    machine_requirement: dict[str, int] = {}
    for g in groups:
        machine_requirement[g["machine_type"]] = (
            machine_requirement.get(g["machine_type"], 0) + g["operator_count"]
        )

    stations = [
        {
            "station_no": g["station_no"],
            "machine_type": g["machine_type"],
            "operations": g["operations"],
            "operator_count": g["operator_count"],
            "smv_total": round(g["smv_total"], 4),
            "smv_load": round(_load(g), 4),
            "row": g["row"],
            "side": g["side"],
            "position": g["position"],
            "is_bottleneck": g["station_no"] == bottleneck_no,
        }
        for g in groups
    ]

    return {
        "total_smv": total_smv,
        "target_per_hour": target_per_hour,
        "takt_time": takt_time,
        "working_hours": working_hours,
        "day_target": round(target_per_hour * working_hours),
        "manpower_used": sum(g["operator_count"] for g in groups),
        "station_count": len(stations),
        "balance_pct": balance_pct,
        "bottleneck_station": bottleneck_no,
        "machine_requirement": machine_requirement,
        "stations": stations,
    }
