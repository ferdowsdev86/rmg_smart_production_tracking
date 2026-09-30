"""Quality monitoring APIs — scan bundle barcode, record defect / reject per part.

GET  /api/automation/quality/bundle/?barcode=...
     Bundle header (style / order / po / size) + one entry per PART of the
     bundle (sibling cut slips share bcss_id + bcm_id), each with its own
     barcode and current defect / reject / pass from machin_production_count.

POST /api/automation/quality/check/   {barcode, defect, reject[, mode]}
     barcode is the PART's slip barcode; updates machin_production_count
     defect / reject bundle_id-wise (insert when the part was never scanned).
"""

from __future__ import annotations

import logging

from django.db import connections
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from mbm_automation.bundle_barcode import lookup_bundle_by_barcode

logger = logging.getLogger(__name__)

def _sibling_parts(barcode: str) -> list[dict]:
    """All parts of the scanned bundle: [{barcode, part_name}, ...].

    Two indexed lookups instead of a self-join on the 10M-row
    bundle_cut_slips table (barcode index, then idx_bcs_bcss_bcm).
    """
    try:
        with connections["mbm_automation"].cursor() as cursor:
            cursor.execute(
                "SELECT bcss_id, bcm_id FROM mbm_production.bundle_cut_slips "
                "WHERE barcode = %s LIMIT 1",
                [barcode],
            )
            row = cursor.fetchone()
            if not row:
                return []
            cursor.execute(
                "SELECT barcode, part FROM mbm_production.bundle_cut_slips "
                "WHERE bcss_id = %s AND bcm_id = %s ORDER BY id ASC",
                [row[0], row[1]],
            )
            return [
                {"barcode": str(r[0]), "part_name": (r[1] or "").strip() or "—"}
                for r in cursor.fetchall()
            ]
    except Exception:
        return []


def _count_rows(barcode: str) -> list[dict]:
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "SELECT machin_id, floor, line, date, bundle_qty, defect, reject, "
            "part_no, qc_checked "
            "FROM machin_production_count WHERE bundle_id = %s",
            [barcode],
        )
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _count_rows_many(barcodes: list[str]) -> dict[str, list[dict]]:
    """One query for all parts' count rows (keeps latency low over the
    remote-DB link), keyed by bundle_id."""
    result: dict[str, list[dict]] = {b: [] for b in barcodes}
    if not barcodes:
        return result
    marks = ", ".join(["%s"] * len(barcodes))
    with connections["default"].cursor() as cursor:
        cursor.execute(
            "SELECT bundle_id, machin_id, floor, line, date, bundle_qty, defect, "
            f"reject, part_no, qc_checked FROM machin_production_count WHERE bundle_id IN ({marks})",
            barcodes,
        )
        cols = [d[0] for d in cursor.description]
        for row in cursor.fetchall():
            r = dict(zip(cols, row))
            result.setdefault(str(r.pop("bundle_id")), []).append(r)
    return result


def _part_summary(
    part_barcode: str, part_name: str, qty: int, rows: list[dict] | None = None
) -> dict:
    if rows is None:
        rows = _count_rows(part_barcode)
    defect = sum(int(r["defect"] or 0) for r in rows)
    reject = sum(int(r["reject"] or 0) for r in rows)
    real_scans = [r for r in rows if int(r["machin_id"] or 0) > 0]
    return {
        "barcode": part_barcode,
        "part_name": part_name,
        "qty": qty,
        "defect": defect,
        "reject": reject,
        "pass_qty": max(0, qty - defect - reject),
        # Part is QC-able only when it already exists in machin_production_count.
        "scanned": bool(rows),
        "checked": any(int(r.get("qc_checked") or 0) for r in rows),
        "stations": [
            {
                "machin_id": r["machin_id"],
                "floor": r["floor"],
                "line": r["line"],
                "date": r["date"].isoformat() if r["date"] else None,
            }
            for r in real_scans
        ],
    }


def _prev_pass_many(barcodes: list[str]) -> dict[str, int]:
    """Cumulative QC pass already saved TODAY for each PART barcode
    (day_qc_diffect.bundle_id). Rows written by one save share
    bundle_id + created_at (one row per defect type), so group per save
    first (MAX) and sum the per-save passes."""
    from zoneinfo import ZoneInfo

    from django.utils import timezone as _tz

    result = {b: 0 for b in barcodes}
    if not barcodes:
        return result
    today = _tz.now().astimezone(ZoneInfo("Asia/Dhaka")).date()
    try:
        marks = ", ".join(["%s"] * len(barcodes))
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT bundle_id, COALESCE(SUM(p), 0) FROM ("
                "SELECT bundle_id, created_at, MAX(pass_qty) AS p FROM day_qc_diffect "
                f"WHERE date = %s AND bundle_id IN ({marks}) "
                "GROUP BY bundle_id, created_at) t GROUP BY bundle_id",
                [today, *barcodes],
            )
            for bid, p in cursor.fetchall():
                result[str(bid)] = int(p or 0)
    except Exception:
        pass
    return result


def _group_total_pass(bundle: dict, barcode: str | None = None) -> int:
    """Pass already recorded today for THIS part barcode — new pass =
    qty - defect - reject - this (so re-checks / repairs never double count,
    and other bundles of the same style/PO are not affected)."""
    key = str(barcode or bundle.get("barcode") or "")
    return _prev_pass_many([key]).get(key, 0) if key else 0


class QualityBundleView(APIView):
    """GET quality/bundle/?barcode= — header + per-part QC state."""

    def get(self, request):
        barcode = (request.query_params.get("barcode") or "").strip()
        if not barcode:
            return Response({"detail": "barcode is required."}, status=400)

        bundle = lookup_bundle_by_barcode(barcode)
        if not bundle:
            return Response(
                {"found": False, "barcode": barcode, "detail": "Bundle not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        qty = int(bundle.get("qty") or 0)
        parts = _sibling_parts(barcode) or [
            {"barcode": barcode, "part_name": bundle.get("part_name") or "—"}
        ]
        rows_by_barcode = _count_rows_many([p["barcode"] for p in parts])
        # Pass already recorded today per PART barcode —
        # new pass for a part = qty - defect - reject - its own previous pass.
        prev_pass = _prev_pass_many([p["barcode"] for p in parts])
        part_list = []
        for p in parts:
            summary = _part_summary(
                p["barcode"], p["part_name"], qty,
                rows=rows_by_barcode.get(p["barcode"], []),
            )
            summary["total_pass"] = prev_pass.get(p["barcode"], 0)
            part_list.append(summary)
        return Response(
            {
                "found": True,
                "barcode": barcode,
                "style": bundle.get("stl_no"),
                "order_no": bundle.get("order_no"),
                "po_no": bundle.get("po_no"),
                "size_no": bundle.get("size_no"),
                "bundle_no": bundle.get("bundle_no"),
                "start_ply": bundle.get("start_ply"),
                "end_ply": bundle.get("end_ply"),
                "qty": qty,
                "total_pass": prev_pass.get(barcode, 0),
                "parts": part_list,
            }
        )


class QualityCheckView(APIView):
    """POST quality/check/ — record defect/reject for ONE part (its slip barcode).

    mode "add" (default) increments; "set" overwrites. When the part has no
    machin_production_count row yet (never scanned at a station), a QC row is
    inserted with machin_id = 0.
    """

    def post(self, request):
        barcode = str(request.data.get("barcode") or "").strip()
        if not barcode:
            return Response({"detail": "barcode is required."}, status=400)
        try:
            defect = max(0, int(request.data.get("defect") or 0))
            reject = max(0, int(request.data.get("reject") or 0))
        except (TypeError, ValueError):
            return Response({"detail": "defect / reject must be numbers."}, status=400)
        mode = str(request.data.get("mode") or "add").strip().lower()

        bundle = lookup_bundle_by_barcode(barcode)
        if not bundle:
            return Response(
                {"found": False, "detail": "Bundle part not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        qty = int(bundle.get("qty") or 0)
        part_name = (bundle.get("part_name") or "").strip()
        rows = _count_rows(barcode)
        if not rows:
            # Part never scanned at a station — create a QC-only row
            # (machin_id=0) so every part of the bundle can be checked and
            # saved under its OWN barcode. Floor/line borrowed from any
            # scanned sibling part of the same bundle.
            sib_floor = sib_line = 0
            try:
                sibs = _sibling_parts(barcode)
                sib_rows = _count_rows_many([p["barcode"] for p in sibs]) if sibs else {}
                for rr in (r for lst in sib_rows.values() for r in lst):
                    if int(rr.get("machin_id") or 0) > 0:
                        sib_floor = int(rr.get("floor") or 0)
                        sib_line = int(rr.get("line") or 0)
                        break
            except Exception:
                pass
            from django.utils import timezone as _qtz

            with connections["default"].cursor() as cursor:
                cursor.execute(
                    "INSERT INTO machin_production_count "
                    "(floor, line, date, style, bundle_qty, defect, reject, "
                    "machin_id, bundle_id, po_no, `order`, size, part_no, qc_checked) "
                    "VALUES (%s, %s, %s, %s, %s, 0, 0, 0, %s, %s, %s, %s, %s, 0)",
                    [
                        sib_floor,
                        sib_line,
                        _qtz.localdate(),
                        str(bundle.get("stl_no") or "")[:100],
                        qty,
                        barcode,
                        str(bundle.get("po_no") or "")[:100] or "",
                        str(bundle.get("order_no") or "")[:100] or "",
                        str(bundle.get("size_no") or "")[:50] or "",
                        part_name[:100] or "",
                    ],
                )
            rows = _count_rows(barcode)
        current_defect = sum(int(r["defect"] or 0) for r in rows)
        current_reject = sum(int(r["reject"] or 0) for r in rows)
        new_defect = defect if mode == "set" else current_defect + defect
        new_reject = reject if mode == "set" else current_reject + reject
        # Once the group's total pass reaches the bundle qty, no further
        # defect / reject can be recorded.
        total_pass = _group_total_pass(bundle, barcode)
        remaining = max(0, qty - total_pass)
        # Partial check: pieces inspected in THIS save (default = all remaining)
        try:
            check_qty = int(request.data.get("check_qty") or remaining)
        except (TypeError, ValueError):
            return Response({"detail": "check_qty must be a number."}, status=400)
        check_qty = max(0, min(check_qty, remaining))
        if total_pass >= qty and (
            new_defect > current_defect or new_reject > current_reject
        ):
            return Response({"detail": "Already total qty was pass"}, status=400)
        if new_defect + new_reject > qty:
            return Response(
                {
                    "detail": (
                        f"defect + reject ({new_defect + new_reject}) cannot exceed "
                        f"part qty ({qty})."
                    )
                },
                status=400,
            )
        inc_defect = max(0, new_defect - current_defect)
        inc_reject = max(0, new_reject - current_reject)
        if inc_defect + inc_reject > check_qty:
            return Response(
                {
                    "detail": (
                        f"new defect + reject ({inc_defect + inc_reject}) cannot exceed "
                        f"QC check qty ({check_qty})."
                    )
                },
                status=400,
            )

        with connections["default"].cursor() as cursor:
            if mode == "set":
                cursor.execute(
                    "UPDATE machin_production_count "
                    "SET defect=%s, reject=%s, qc_checked=1 "
                    "WHERE bundle_id=%s",
                    [defect, reject, barcode],
                )
            else:
                cursor.execute(
                    "UPDATE machin_production_count "
                    "SET defect = defect + %s, reject = reject + %s, qc_checked=1 "
                    "WHERE bundle_id=%s",
                    [defect, reject, barcode],
                )

        # Day-wise QC record with the selected defect types.
        # pass = in - defect - reject - (pass already saved today for this
        # date/style/order/po/color/size group) → only the NEW pass is stored.
        # pass this save = pieces checked now - NEW defects - NEW rejects,
        # capped at bundle qty - (total pass + defect + reject): pieces still
        # defective (unrepaired) or rejected can not pass. Repaired pieces
        # come back through a later re-check save.
        pass_to_save = max(
            0,
            min(
                remaining,
                check_qty - inc_defect - inc_reject,
                qty - total_pass - new_defect - new_reject,
            ),
        )
        # Increases land in the defect/reject columns; ONLY decreases (pcs
        # repaired back to pass) are recorded in the *_to_pass columns.
        defect_to_pass = max(0, current_defect - new_defect)
        reject_to_pass = max(0, current_reject - new_reject)
        defects_in = request.data.get("defects") or []
        qc_saved = _save_day_qc_diffect(
            barcode=barcode,
            bundle=bundle,
            rows=rows,
            qty=qty,
            total_defect=new_defect,
            total_reject=new_reject,
            defects=defects_in if isinstance(defects_in, list) else [],
            prev_defect=current_defect,
            prev_reject=current_reject,
            pass_qty=pass_to_save,
            defect_to_pass=defect_to_pass,
            reject_to_pass=reject_to_pass,
            # QC check = pieces inspected in this save
            qc_check=check_qty,
        )

        # Push updated summaries to every machine/date this bundle touched.
        from mbm_automation.board_notify import notify_sewing_board
        from mbm_automation.production_summary import publish_machine_summary

        seen = set()
        for r in rows:
            mid = int(r["machin_id"] or 0)
            if mid > 0 and (mid, r["date"]) not in seen:
                seen.add((mid, r["date"]))
                publish_machine_summary(mid, r["date"])

        # Always ping boards even when no machin_id rows were touched.
        notify_sewing_board(reason="quality_check")

        return Response(
            {
                "message": "Saved",
                **_part_summary(barcode, part_name or "—", qty),
                "pass_qty": pass_to_save,
                "check_qty": check_qty,
                "qc_saved": bool(qc_saved),
                **({"warning": "QC history row could not be saved — please re-save."} if not qc_saved else {}),
                "total_pass": total_pass + pass_to_save,
                "diffect_to_pass": defect_to_pass,
                "reject_to_pass": reject_to_pass,
            }
        )


class QualityDefectTypesView(APIView):
    """GET quality/defect_types/ — defect list from qc_diffect (sl, code, name)."""

    def get(self, request):
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT sl, defect_code, defect_name FROM qc_diffect ORDER BY sl"
            )
            rows = [
                {"sl": int(r[0]), "defect_code": r[1], "defect_name": r[2]}
                for r in cursor.fetchall()
            ]
        return Response({"defects": rows})


def _save_day_qc_diffect(
    *,
    barcode: str,
    bundle: dict,
    rows: list[dict],
    qty: int,
    total_defect: int,
    total_reject: int,
    defects: list[dict],
    prev_defect: int = 0,
    prev_reject: int = 0,
    pass_qty: int | None = None,
    defect_to_pass: int = 0,
    reject_to_pass: int = 0,
    qc_check: int | None = None,
) -> bool:
    """One day_qc_diffect row per selected defect type (or a single summary
    row when no type was selected). Best effort — never blocks the QC save."""
    try:
        from zoneinfo import ZoneInfo

        from django.utils import timezone as _tz

        factory_tz = ZoneInfo("Asia/Dhaka")

        floor = line = 0
        machin_id = None
        for r in rows:
            if int(r.get("machin_id") or 0) > 0:
                floor = int(r.get("floor") or 0)
                line = int(r.get("line") or 0)
                machin_id = int(r.get("machin_id"))
                break
        if machin_id is None and rows:
            floor = int(rows[0].get("floor") or 0)
            line = int(rows[0].get("line") or 0)
        if not floor and not line:
            # Part never scanned at a station: attribute the QC record to the
            # layout's line when the factory runs a single line, so line
            # reports and dashboard totals stay identical.
            try:
                from mbm_automation.models import LineLayout

                lines = list(
                    LineLayout.objects.values_list("floor", "line_no").distinct()
                )
                if len(lines) == 1:
                    floor, line = int(lines[0][0] or 0), int(lines[0][1] or 0)
            except Exception:
                pass
        machin_code = ""
        operator_id = ""
        if machin_id:
            try:
                from mbm_automation.models import LineLayout
                from mbm_automation.sewing_analysis import resolve_active_machin_user

                lrow = LineLayout.objects.filter(machin_no=machin_id).first()
                machin_code = (lrow.machin_name or "") if lrow else ""
                operator_id = resolve_active_machin_user(machin_id, _tz.now().astimezone(factory_tz).date()) or ""
            except Exception:
                pass

        # Resolve selected defect types against qc_diffect (authoritative).
        entries: list[tuple] = []
        if defects:
            sls = [int(d.get("sl") or 0) for d in defects if int(d.get("sl") or 0) > 0]
            names: dict[int, tuple] = {}
            if sls:
                marks = ", ".join(["%s"] * len(sls))
                with connections["default"].cursor() as cursor:
                    cursor.execute(
                        f"SELECT sl, defect_code, defect_name FROM qc_diffect "
                        f"WHERE sl IN ({marks})",
                        sls,
                    )
                    names = {int(r[0]): (r[1], r[2]) for r in cursor.fetchall()}
            for d in defects:
                sl = int(d.get("sl") or 0)
                dqty = max(0, int(d.get("qty") or 0))
                if sl in names and dqty > 0:
                    entries.append((sl, names[sl][0], names[sl][1], dqty))
        # New defects this save: typed entries, or the plain delta when no type
        # was selected (repair / reject-only saves carry 0 new defects).
        typeless_new = 0 if entries else max(0, total_defect - prev_defect)
        new_defect_total = sum(e[3] for e in entries) + typeless_new
        if len(entries) == 1:
            d_sl, d_code, d_name = entries[0][0], entries[0][1], entries[0][2]
        elif entries:
            d_sl = None
            d_code = (", ".join(str(e[1]) for e in entries))[:255]
            d_name = (", ".join(str(e[2]) for e in entries))[:500]
        else:
            d_sl = d_code = d_name = None

        if pass_qty is None:
            pass_qty = max(0, qty - total_defect - total_reject)
        # reject_qty stores the NEW rejects of this save (delta), same as
        # defect_qty — decreases go to reject_to_pass instead.
        reject_delta = max(0, total_reject - prev_reject)
        now = _tz.now().astimezone(factory_tz)
        with connections["default"].cursor() as cursor:
            # qc_check = bundle qty - pass already recorded today for this
            # part (pieces presented for checking at this save).
            if qc_check is None:
                cursor.execute(
                    "SELECT COALESCE(SUM(p), 0) FROM (SELECT MAX(pass_qty) AS p "
                    "FROM day_qc_diffect WHERE date = %s AND bundle_id = %s "
                    "GROUP BY created_at) t",
                    [now.date(), barcode],
                )
                qc_check = max(0, qty - int(cursor.fetchone()[0] or 0))

            # ONE row per QC save in day_qc_diffect with the save TOTALS
            cursor.execute(
                "INSERT INTO day_qc_diffect "
                "(date, unit, buyer, style, floor, line, bundle_id, part_no, "
                "defect_sl, defect_code, defect_name, bundle_qty, pass_qty, "
                "defect_qty, reject_qty, created_at, machin_id, machin_code, operator_id, "
                "mbm_order, po, color, size, diffect_to_pass, reject_to_pass, qc_check) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    now.date(),
                    (bundle.get("unit_name") or "")[:100] or None,
                    (bundle.get("buyer_name") or "")[:100] or None,
                    (bundle.get("stl_no") or "")[:100] or None,
                    floor,
                    line,
                    barcode,
                    (bundle.get("part_name") or "")[:100] or None,
                    d_sl,
                    d_code,
                    d_name,
                    qty,
                    pass_qty,
                    new_defect_total,
                    reject_delta,
                    now.strftime("%Y-%m-%d %H:%M:%S"),
                    machin_id,
                    machin_code[:50] or None,
                    operator_id[:50] or None,
                    (bundle.get("order_no") or "")[:100] or None,
                    (bundle.get("po_no") or "")[:100] or None,
                    (bundle.get("color_name") or "")[:100] or None,
                    (str(bundle.get("size_no") or ""))[:50] or None,
                    int(defect_to_pass),
                    int(reject_to_pass),
                    int(qc_check),
                ],
            )
            dqd_id = cursor.lastrowid

            # Defect-name-wise breakdown → hour_quality_diffect (one row per
            # defect type of this save, all linked to the single day row).
            ledger = [(sl, code, name, dqty, 0, 0, 0) for (sl, code, name, dqty) in entries]
            if not entries or defect_to_pass or reject_delta or reject_to_pass:
                ledger.append(
                    (None, None, None, typeless_new,
                     int(defect_to_pass), reject_delta, int(reject_to_pass))
                )
            for sl, code, name, dq, dp, rq, rp in ledger:
                try:
                    cursor.execute(
                        "INSERT INTO hour_quality_diffect "
                        "(day_qc_diffect_id, diffect_sl, diffect_code, diffect_name, "
                        "diffect_qty, diffect_pass, reject_qty, reject_pass, created_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        [dqd_id, sl, code, name, dq, dp, rq, rp,
                         now.strftime("%Y-%m-%d %H:%M:%S")],
                    )
                except Exception:
                    logger.exception("hour_quality_diffect insert failed for %s", barcode)
        return True
    except Exception:
        logger.exception("day_qc_diffect save FAILED for barcode %s", barcode)
        return False
