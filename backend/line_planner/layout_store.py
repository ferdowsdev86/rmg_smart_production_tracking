"""Persist saved line layouts in the default DB (smartfinishinfloor).

Two tables:
  * ``mastar_line_layout`` — the master (current) layout, one row per
    style(OB)+line+floor. Re-saving the same style+line updates this row.
  * ``child_line_layout``  — a date-wise snapshot written every time the layout
    is saved/changed, one row per master+date (re-saving the same date replaces
    it), so the layout keeps a per-day history.

The whole planner ``result`` (inputs, summary, operator slots with machine
assignments) is stored as JSON in ``layout_json``; a few columns are pulled out
for querying/listing. Tables are created with raw DDL because this venv's
MySQL driver blocks Django migrations.
"""

from __future__ import annotations

import json

from django.db import connections
from django.utils import timezone

_CONN = "default"

MASTER_TABLE = "mastar_line_layout"
CHILD_TABLE = "child_line_layout"

_CREATE_MASTER = f"""
CREATE TABLE IF NOT EXISTS {MASTER_TABLE} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  obm_id INT NOT NULL,
  line_no INT NOT NULL DEFAULT 0,
  floor INT NOT NULL DEFAULT 0,
  style_no VARCHAR(120) NULL,
  buyer_name VARCHAR(190) NULL,
  line_name VARCHAR(120) NULL,
  manpower INT NULL,
  target_per_hour DECIMAL(10,2) NULL,
  efficiency DECIMAL(7,4) NULL,
  working_hours DECIMAL(6,2) NULL,
  shape VARCHAR(20) NULL,
  total_smv DECIMAL(10,2) NULL,
  station_count INT NULL,
  balance_pct DECIMAL(6,2) NULL,
  bottleneck_station INT NULL,
  layout_json LONGTEXT NULL,
  created_by VARCHAR(120) NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_master (obm_id, line_no, floor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_CHILD = f"""
CREATE TABLE IF NOT EXISTS {CHILD_TABLE} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  master_id BIGINT NOT NULL,
  obm_id INT NOT NULL,
  line_no INT NOT NULL DEFAULT 0,
  floor INT NOT NULL DEFAULT 0,
  layout_date DATE NOT NULL,
  manpower INT NULL,
  target_per_hour DECIMAL(10,2) NULL,
  efficiency DECIMAL(7,4) NULL,
  working_hours DECIMAL(6,2) NULL,
  shape VARCHAR(20) NULL,
  total_smv DECIMAL(10,2) NULL,
  station_count INT NULL,
  balance_pct DECIMAL(6,2) NULL,
  layout_json LONGTEXT NULL,
  created_by VARCHAR(120) NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_child (master_id, layout_date),
  KEY idx_child_lookup (obm_id, line_no, floor, layout_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_tables() -> None:
    with connections[_CONN].cursor() as cur:
        cur.execute(_CREATE_MASTER)
        cur.execute(_CREATE_CHILD)


def _rows(sql, params=None):
    with connections[_CONN].cursor() as cur:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _summary_cols(result: dict) -> dict:
    style = result.get("style") or {}
    line = result.get("line") or {}
    inputs = result.get("inputs") or {}
    return {
        "obm_id": int(inputs.get("obm_id") or style.get("obm_id") or 0),
        "line_no": int(line.get("line_no") or inputs.get("line_no") or 0),
        "floor": int(line.get("floor") or inputs.get("floor") or 0),
        "style_no": str(style.get("stl_no") or "")[:120] or None,
        "buyer_name": str(style.get("buyer_name") or "")[:190] or None,
        "line_name": str(style.get("hr_line_name") or "")[:120] or None,
        "manpower": inputs.get("manpower") or result.get("manpower_used"),
        "target_per_hour": result.get("target_per_hour"),
        "efficiency": inputs.get("efficiency"),
        "working_hours": inputs.get("working_hours") or result.get("working_hours"),
        "shape": str(inputs.get("shape") or "straight")[:20],
        "total_smv": result.get("total_smv"),
        "station_count": result.get("station_count"),
        "balance_pct": result.get("balance_pct"),
        "bottleneck_station": result.get("bottleneck_station"),
    }


def save_layout(result: dict, *, layout_date: str, user: str | None = None) -> dict:
    """Upsert the master layout and write/replace the date-wise child snapshot."""
    ensure_tables()
    cols = _summary_cols(result)
    if not cols["obm_id"]:
        raise ValueError("result has no obm_id")
    payload = json.dumps(result, default=str)
    now = timezone.now()
    conn = connections[_CONN]

    with conn.cursor() as cur:
        # --- master (one per obm_id+line+floor) -----------------------------
        cur.execute(
            f"""
            INSERT INTO {MASTER_TABLE}
              (obm_id, line_no, floor, style_no, buyer_name, line_name, manpower,
               target_per_hour, efficiency, working_hours, shape, total_smv,
               station_count, balance_pct, bottleneck_station, layout_json,
               created_by, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              style_no=VALUES(style_no), buyer_name=VALUES(buyer_name),
              line_name=VALUES(line_name), manpower=VALUES(manpower),
              target_per_hour=VALUES(target_per_hour), efficiency=VALUES(efficiency),
              working_hours=VALUES(working_hours), shape=VALUES(shape),
              total_smv=VALUES(total_smv), station_count=VALUES(station_count),
              balance_pct=VALUES(balance_pct), bottleneck_station=VALUES(bottleneck_station),
              layout_json=VALUES(layout_json), updated_at=VALUES(updated_at)
            """,
            [
                cols["obm_id"], cols["line_no"], cols["floor"], cols["style_no"],
                cols["buyer_name"], cols["line_name"], cols["manpower"],
                cols["target_per_hour"], cols["efficiency"], cols["working_hours"],
                cols["shape"], cols["total_smv"], cols["station_count"],
                cols["balance_pct"], cols["bottleneck_station"], payload,
                user, now, now,
            ],
        )
        cur.execute(
            f"SELECT id FROM {MASTER_TABLE} WHERE obm_id=%s AND line_no=%s AND floor=%s",
            [cols["obm_id"], cols["line_no"], cols["floor"]],
        )
        master_id = cur.fetchone()[0]

        # --- child (one per master+date) ------------------------------------
        cur.execute(
            f"""
            INSERT INTO {CHILD_TABLE}
              (master_id, obm_id, line_no, floor, layout_date, manpower,
               target_per_hour, efficiency, working_hours, shape, total_smv,
               station_count, balance_pct, layout_json, created_by, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              manpower=VALUES(manpower), target_per_hour=VALUES(target_per_hour),
              efficiency=VALUES(efficiency), working_hours=VALUES(working_hours),
              shape=VALUES(shape), total_smv=VALUES(total_smv),
              station_count=VALUES(station_count), balance_pct=VALUES(balance_pct),
              layout_json=VALUES(layout_json), updated_at=VALUES(updated_at)
            """,
            [
                master_id, cols["obm_id"], cols["line_no"], cols["floor"], layout_date,
                cols["manpower"], cols["target_per_hour"], cols["efficiency"],
                cols["working_hours"], cols["shape"], cols["total_smv"],
                cols["station_count"], cols["balance_pct"], payload, user, now, now,
            ],
        )

    return {"master_id": master_id, "layout_date": layout_date, "saved_at": now.isoformat()}


def get_layout(obm_id: int, line_no: int, floor: int, layout_date: str | None = None) -> dict | None:
    """Return the saved layout: the child snapshot for the date if one exists,
    otherwise the master. ``None`` when nothing is saved for this style+line."""
    ensure_tables()
    if layout_date:
        child = _rows(
            f"SELECT * FROM {CHILD_TABLE} WHERE obm_id=%s AND line_no=%s AND floor=%s "
            f"AND layout_date=%s LIMIT 1",
            [obm_id, line_no, floor, layout_date],
        )
        if child:
            return _unpack(child[0], source="child")

    master = _rows(
        f"SELECT * FROM {MASTER_TABLE} WHERE obm_id=%s AND line_no=%s AND floor=%s LIMIT 1",
        [obm_id, line_no, floor],
    )
    if master:
        return _unpack(master[0], source="master")
    return None


def list_saved_dates(obm_id: int, line_no: int, floor: int) -> list[str]:
    ensure_tables()
    rows = _rows(
        f"SELECT layout_date FROM {CHILD_TABLE} WHERE obm_id=%s AND line_no=%s AND floor=%s "
        f"ORDER BY layout_date DESC",
        [obm_id, line_no, floor],
    )
    return [str(r["layout_date"]) for r in rows]


def _unpack(row: dict, *, source: str) -> dict:
    try:
        result = json.loads(row.get("layout_json") or "null")
    except (TypeError, ValueError):
        result = None
    return {
        "source": source,
        "layout_date": str(row.get("layout_date")) if row.get("layout_date") else None,
        "saved_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        "result": result,
    }
