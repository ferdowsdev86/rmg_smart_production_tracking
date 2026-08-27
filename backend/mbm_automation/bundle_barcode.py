"""Resolve bundle-cut slip barcode (flag9) → production qty + slip details."""

from __future__ import annotations

from typing import Any

from django.db import connections

# Prefer automation connection (same MariaDB host as mbm_production / cuttingedgedb).
_DB_ALIAS = "mbm_automation"

_BUNDLE_SQL = """
SELECT
    ms.stl_no,
    mb.b_name AS buyer_name,
    mc.clr_name AS color_name,
    hu.hr_unit_name AS unit_name,
    hl.hr_line_name AS line_no,
    hf.hr_floor_name AS floor_no,
    mpo.po_no,
    moe.order_code AS order_no,
    sz.size_no,
    csz.bundle_no,
    sp.part AS part_name,
    csz.start_ply,
    csz.end_ply,
    s.qty AS qty
FROM mbm_production.bundle_cut_slips AS sp
INNER JOIN mbm_production.bundle_cut_master AS bcm
    ON bcm.id = sp.bcm_id
INNER JOIN cuttingedgedb.mr_style AS ms
    ON ms.stl_id = bcm.stl_id
INNER JOIN mbm_production.bundle_cut_size_shade AS csz
    ON csz.id = sp.bcss_id
INNER JOIN mbm_production.bundle_cut_shade AS s
    ON s.id = csz.bc_shade_id
INNER JOIN mbm_production.bundle_cut_size AS sz
    ON sz.id = csz.bc_size_id
LEFT JOIN cuttingedgedb.mr_purchase_order AS mpo
    ON mpo.po_id = csz.po_id
LEFT JOIN cuttingedgedb.mr_order_entry AS moe
    ON moe.order_id = mpo.mr_order_entry_order_id
LEFT JOIN cuttingedgedb.mr_buyer AS mb
    ON mb.b_id = ms.mr_buyer_b_id
LEFT JOIN cuttingedgedb.mr_material_color AS mc
    ON mc.clr_id = mpo.clr_id
LEFT JOIN mbm_production.bundle_statement_details AS bsd
    ON bsd.bcss_id = sp.bcss_id
LEFT JOIN mbm_production.bundle_statement AS bs
    ON bs.id = bsd.bs_id
    AND bs.bcm_id = sp.bcm_id
LEFT JOIN cuttingedgedb.hr_unit AS hu
    ON hu.hr_unit_id = bs.unit_id
LEFT JOIN cuttingedgedb.hr_line AS hl
    ON hl.hr_line_id = bs.line_id
LEFT JOIN cuttingedgedb.hr_floor AS hf
    ON hf.hr_floor_id = hl.hr_line_floor_id
WHERE sp.barcode = %s
ORDER BY sp.id ASC
LIMIT 1
"""


def normalize_flag9(value: Any) -> str:
    """Storeable flag9 string; empty / None → '0'."""
    if value is None:
        return "0"
    text = str(value).strip()
    return text[:50] if text else "0"


def flag9_is_empty(value: Any) -> bool:
    key = normalize_flag9(value)
    return key in {"0", ""}


def flag9_is_trackable_barcode(value: Any) -> bool:
    """True when flag9 is a real barcode (not empty and not legacy pulse ``1``)."""
    key = normalize_flag9(value)
    return key not in {"0", "", "1"}


def lookup_bundle_by_barcode(barcode: str) -> dict[str, Any] | None:
    """Return first matching bundle-cut slip row for barcode, or None."""
    key = (barcode or "").strip()
    if not key or key == "0":
        return None

    try:
        with connections[_DB_ALIAS].cursor() as cursor:
            cursor.execute(_BUNDLE_SQL, [key])
            row = cursor.fetchone()
            if not row:
                return None
            cols = [col[0] for col in cursor.description]
    except Exception:
        return None

    data = dict(zip(cols, row))
    try:
        data["qty"] = int(data.get("qty") or 0)
    except (TypeError, ValueError):
        data["qty"] = 0
    data["barcode"] = key
    return data


def production_qty_for_flag9(flag9: Any, *, cache: dict[str, int] | None = None) -> int:
    """
    Production pieces for one sewing_log.flag9 value.

    - 0 / empty / null → 0
    - legacy ``1`` → 1 (old +1 piece pulse)
    - otherwise treat as barcode → ``s.qty`` from bundle_cut_slips query
    """
    key = normalize_flag9(flag9)
    if key in {"0", ""}:
        return 0
    if key == "1":
        return 1
    if cache is not None and key in cache:
        return cache[key]
    bundle = lookup_bundle_by_barcode(key)
    qty = int(bundle["qty"]) if bundle else 0
    if cache is not None:
        cache[key] = qty
    return qty


def sum_production_qtys(flag9_values: list[Any]) -> int:
    """Sum production for many flag9 values (batch barcode cache)."""
    cache: dict[str, int] = {}
    total = 0
    for value in flag9_values:
        total += production_qty_for_flag9(value, cache=cache)
    return total


def _leading_int(value: Any) -> int:
    """First integer found in a name like 'Floor-3' / 'Line 12'; 0 when none."""
    import re

    match = re.search(r"\d+", str(value or ""))
    return int(match.group()) if match else 0


def _floor_line_for_machine(machin_id: int) -> tuple[int, int]:
    """floor / line_no from the line layout for the scanning machine (0, 0 when unknown)."""
    try:
        from mbm_automation.models import LineLayout

        row = (
            LineLayout.objects.filter(machin_no=machin_id)
            .values("floor", "line_no")
            .first()
        )
        if row:
            return int(row["floor"] or 0), int(row["line_no"] or 0)
    except Exception:
        pass
    return 0, 0


def upsert_machin_production_count(
    *,
    machin_id: int,
    barcode: str,
    on_date: Any,
    bundle: dict[str, Any] | None = None,
) -> bool:
    """
    Mirror one flag9 barcode capture into smartfinishinfloor.machin_production_count
    (style / po / bundle qty resolved via the bundle_cut_slips query).
    Idempotent per (machin_id, bundle_id=barcode). Returns True when written.
    """
    key = normalize_flag9(barcode)
    if machin_id is None or not flag9_is_trackable_barcode(key):
        return False
    bundle = bundle or lookup_bundle_by_barcode(key)
    if not bundle:
        return False

    # Floor/line of the SCANNING machine from the line layout; the bundle's
    # statement floor/line names are only a fallback (often NULL).
    floor_no, line_no = _floor_line_for_machine(int(machin_id))
    fields = {
        "floor": floor_no or _leading_int(bundle.get("floor_no")),
        "line": line_no or _leading_int(bundle.get("line_no")),
        "date": on_date,
        "style": str(bundle.get("stl_no") or "")[:100],
        "bundle_qty": int(bundle.get("qty") or 0),
        "po_no": str(bundle.get("po_no") or "")[:100] or None,
        "`order`": str(bundle.get("order_no") or "")[:100] or None,
        "size": str(bundle.get("size_no") or "")[:50] or None,
        "part_no": str(bundle.get("part_name") or "")[:100] or None,
    }
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) FROM machin_production_count "
                "WHERE machin_id = %s AND bundle_id = %s",
                [int(machin_id), key],
            )
            set_cols = ", ".join(f"{col}=%s" for col in fields)
            if cursor.fetchone()[0]:
                cursor.execute(
                    f"UPDATE machin_production_count SET {set_cols} "
                    "WHERE machin_id=%s AND bundle_id=%s",
                    [*fields.values(), int(machin_id), key],
                )
            else:
                cols = ", ".join(fields)
                marks = ", ".join(["%s"] * (len(fields) + 4))
                cursor.execute(
                    f"INSERT INTO machin_production_count "
                    f"({cols}, defect, reject, machin_id, bundle_id) VALUES ({marks})",
                    [*fields.values(), 0, 0, int(machin_id), key],
                )
        # Push the fresh day summary to the machine's MQTT response topic.
        from mbm_automation.production_summary import publish_machine_summary

        publish_machine_summary(int(machin_id), on_date)
        return True
    except Exception:
        return False


def add_pulse_production(machin_id: int, on_date: Any, pieces: int = 1) -> bool:
    """Legacy flag9=1 pulse → +1 production.

    Accumulates into one machin_production_count row per machine + date with
    bundle_id='1', so the pulse joins the same production calculation
    (SUM(bundle_qty) - defect - reject) as barcode scans.
    """
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "UPDATE machin_production_count SET bundle_qty = bundle_qty + %s "
                "WHERE machin_id = %s AND date = %s AND bundle_id = '1'",
                [pieces, int(machin_id), on_date],
            )
            if cursor.rowcount == 0:
                floor_no, line_no = _floor_line_for_machine(int(machin_id))
                cursor.execute(
                    "INSERT INTO machin_production_count "
                    "(floor, line, date, style, bundle_qty, defect, reject, "
                    "machin_id, bundle_id, po_no, `order`, size, part_no) "
                    "VALUES (%s, %s, %s, '', %s, 0, 0, %s, '1', '', '', '', '')",
                    [floor_no, line_no, on_date, pieces, int(machin_id)],
                )
        from mbm_automation.production_summary import publish_machine_summary

        publish_machine_summary(int(machin_id), on_date)
        return True
    except Exception:
        return False


def machine_day_counts(machin_id: int, on_date: Any) -> dict[str, int]:
    """Day totals for one machine from machin_production_count (date+machine
    group): {qty, defect, reject, production} where
    production = qty - (defect + reject)."""
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(SUM(bundle_qty), 0), COALESCE(SUM(defect), 0), "
                "COALESCE(SUM(reject), 0) FROM machin_production_count "
                "WHERE machin_id = %s AND date = %s",
                [int(machin_id), on_date],
            )
            qty, defect, reject = cursor.fetchone()
        qty, defect, reject = int(qty), int(defect), int(reject)
        return {
            "qty": qty,
            "defect": defect,
            "reject": reject,
            "production": max(0, qty - (defect + reject)),
        }
    except Exception:
        return {"qty": 0, "defect": 0, "reject": 0, "production": 0}


def production_achieved_for_machine(machin_id: int, on_date: Any) -> int:
    """Day achievement: SUM(bundle_qty) - (SUM(defect) + SUM(reject))."""
    return machine_day_counts(machin_id, on_date)["production"]


def bundle_response_fields(flag9: Any) -> dict[str, Any]:
    """Extra response fields when flag9 is a non-empty barcode (or legacy 1)."""
    key = normalize_flag9(flag9)
    if key in {"0", ""}:
        return {"production": 0, "qty": 0}

    if key == "1":
        return {"production": 1, "qty": 1, "barcode": key}

    bundle = lookup_bundle_by_barcode(key)
    if not bundle:
        return {
            "production": 0,
            "qty": 0,
            "barcode": key,
            "barcode_found": False,
        }

    qty = int(bundle.get("qty") or 0)
    return {
        "barcode": key,
        "barcode_found": True,
        "stl_no": bundle.get("stl_no"),
        "unit_name": bundle.get("unit_name"),
        "line_no": bundle.get("line_no"),
        "floor_no": bundle.get("floor_no"),
        "po_no": bundle.get("po_no"),
        "order_no": bundle.get("order_no"),
        "size_no": bundle.get("size_no"),
        "bundle_no": bundle.get("bundle_no"),
        "part_name": bundle.get("part_name"),
        "start_ply": bundle.get("start_ply"),
        "end_ply": bundle.get("end_ply"),
        "qty": qty,
        # This scan's production piece count (replaces legacy +1).
        "production": qty,
    }
