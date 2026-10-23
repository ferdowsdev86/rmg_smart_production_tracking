from __future__ import annotations

from datetime import date

from django.http import HttpResponse
from openpyxl import Workbook
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.services import (
    daily_lines_report,
    employee_efficiency_report,
    hourly_for_line,
    mismatch_report,
)
from floors.services import get_today


def _parse_date(val: str | None, default: date) -> date:
    if not val:
        return default
    return date.fromisoformat(val)


class DailyLineReportView(APIView):
    def get(self, request):
        d = _parse_date(request.query_params.get("date"), get_today())
        line_id = request.query_params.get("line_id")
        lid = int(line_id) if line_id else None
        rows = daily_lines_report(d, lid)
        return Response({"date": str(d), "lines": rows})


class HourlyReportView(APIView):
    def get(self, request):
        raw = request.query_params.get("line_id")
        if not raw:
            return Response({"detail": "line_id is required."}, status=400)
        line_id = int(raw)
        d = _parse_date(request.query_params.get("date"), get_today())
        hours = hourly_for_line(line_id, d)
        return Response({"line_id": line_id, "date": str(d), "hours": hours})


class EfficiencyReportView(APIView):
    def get(self, request):
        date_from = _parse_date(request.query_params.get("date_from"), get_today())
        date_to = _parse_date(request.query_params.get("date_to"), get_today())
        employee_id = request.query_params.get("employee_id")
        eid = int(employee_id) if employee_id else None
        rows = employee_efficiency_report(date_from, date_to, eid)
        return Response(
            {
                "date_from": str(date_from),
                "date_to": str(date_to),
                "rows": rows,
            }
        )


class MismatchReportView(APIView):
    def get(self, request):
        date_from = _parse_date(request.query_params.get("date_from"), get_today())
        date_to = _parse_date(request.query_params.get("date_to"), get_today())
        employee_id = request.query_params.get("employee_id")
        line_id = request.query_params.get("line_id")
        eid = int(employee_id) if employee_id else None
        lid = int(line_id) if line_id else None
        rows = mismatch_report(date_from, date_to, eid, lid)
        return Response(
            {
                "date_from": str(date_from),
                "date_to": str(date_to),
                "rows": rows,
            }
        )


class ExportDailyExcelView(APIView):
    def get(self, request):
        d = _parse_date(request.query_params.get("date"), get_today())
        rows = daily_lines_report(d, None)
        wb = Workbook()
        ws = wb.active
        ws.title = "Daily"
        ws.append(["Line", "Target", "Actual", "Efficiency %", "Variance"])
        for r in rows:
            ws.append(
                [
                    r["line_name"],
                    r["target"],
                    r["actual"],
                    r["efficiency_pct"],
                    r["variance"],
                ]
            )
        response = HttpResponse(
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        response["Content-Disposition"] = f'attachment; filename="daily-{d}.xlsx"'
        wb.save(response)
        return response


class ExportDailyPdfView(APIView):
    def get(self, request):
        d = _parse_date(request.query_params.get("date"), get_today())
        rows = daily_lines_report(d, None)
        response = HttpResponse(content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="daily-{d}.pdf"'
        p = canvas.Canvas(response, pagesize=letter)
        width, height = letter
        y = height - 50
        p.setFont("Helvetica-Bold", 14)
        p.drawString(40, y, f"Daily line report — {d}")
        y -= 30
        p.setFont("Helvetica", 10)
        for r in rows:
            line = f"{r['line_name']}: target {r['target']} actual {r['actual']} eff {r['efficiency_pct']}%"
            p.drawString(40, y, line)
            y -= 14
            if y < 50:
                p.showPage()
                y = height - 50
        p.showPage()
        p.save()
        return response


class QualityReportView(APIView):
    """Quality Control In Line / End Line 100% Inspection Report.

    GET /api/reports/quality/?date=YYYY-MM-DD&floor=67&line=327
    Data: day_qc_diffect (+ qc_diffect names). Defect x hour matrix with
    checked / passed / defect / defect%% summary rows, line-wise filter.
    """

    def get(self, request):
        from django.db import connections
        from mbm_automation.models import LineLayout

        d = _parse_date(request.query_params.get("date"), get_today())

        # available lines (from layout, ERP names when possible)
        layout = list(
            LineLayout.objects.values("floor", "line_no").distinct().order_by("floor", "line_no")
        )
        line_ids = sorted({r["line_no"] for r in layout})
        names = {}
        try:
            with connections["cuttingedge"].cursor() as cursor:
                marks = ", ".join(["%s"] * len(line_ids))
                cursor.execute(
                    f"SELECT hr_line_id, hr_line_name FROM hr_line WHERE hr_line_id IN ({marks})",
                    line_ids,
                )
                names = {int(r[0]): str(r[1] or "").strip() for r in cursor.fetchall()}
        except Exception:
            pass
        lines = [
            {
                "floor": r["floor"],
                "line": r["line_no"],
                "label": names.get(int(r["line_no"])) or f"L{r['line_no']}",
            }
            for r in layout
        ]

        try:
            floor = int(request.query_params.get("floor") or (lines[0]["floor"] if lines else 0))
            line = int(request.query_params.get("line") or (lines[0]["line"] if lines else 0))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid floor/line."}, status=400)

        # Rows saved without a station scan carry floor/line 0; when the
        # factory runs a single line they belong to it (matches the dashboard).
        if len(lines) == 1:
            where = "date = %s AND ((floor = %s AND line = %s) OR (floor = 0 AND line = 0))"
        else:
            where = "date = %s AND floor = %s AND line = %s"
        params = [d, floor, line]

        with connections["default"].cursor() as cursor:
            # defect x hour matrix — defect-name-wise rows live in
            # hour_quality_diffect (linked 1:n to the per-save day_qc_diffect row)
            cursor.execute(
                "SELECT HOUR(h.created_at), h.diffect_sl, h.diffect_code, h.diffect_name, "
                "COALESCE(SUM(h.diffect_qty), 0), d.machin_id, d.machin_code, d.operator_id "
                "FROM hour_quality_diffect h "
                "JOIN day_qc_diffect d ON d.id = h.day_qc_diffect_id "
                f"WHERE {where.replace('date =', 'd.date =').replace('floor =', 'd.floor =').replace('line =', 'd.line =')} "
                "GROUP BY HOUR(h.created_at), h.diffect_sl, h.diffect_code, h.diffect_name, "
                "d.machin_id, d.machin_code, d.operator_id",
                params,
            )
            matrix_raw = cursor.fetchall()

            # per-save state for checked/passed/defect/reject summary:
            # pass = SUM(pass_qty); defect = SUM(defect_qty)-SUM(diffect_to_pass);
            # reject = SUM(reject_qty)-SUM(reject_to_pass). Rows of one save
            # share bundle_id + created_at (pass/reject repeat per row).
            cursor.execute(
                "SELECT bundle_id, HOUR(created_at), MAX(bundle_qty), "
                "MAX(pass_qty), COALESCE(SUM(defect_qty), 0), MAX(reject_qty), "
                "COALESCE(MAX(diffect_to_pass), 0), COALESCE(MAX(reject_to_pass), 0), "
                "COALESCE(MAX(qc_check), 0) "
                f"FROM day_qc_diffect WHERE {where} "
                "GROUP BY bundle_id, created_at ORDER BY MIN(created_at)",
                params,
            )
            bundles = cursor.fetchall()

            # header info
            cursor.execute(
                "SELECT GROUP_CONCAT(DISTINCT buyer), GROUP_CONCAT(DISTINCT style), "
                "GROUP_CONCAT(DISTINCT unit) "
                f"FROM day_qc_diffect WHERE {where}",
                params,
            )
            hb = cursor.fetchone() or (None, None, None)

        hours = list(range(8, 19))
        extra = sorted(
            {int(r[0]) for r in matrix_raw} | {int(b[1]) for b in bundles}
        )
        for h in extra:
            if h not in hours:
                hours.append(h)

        by_defect: dict = {}
        for h, sl, code, name, qty, mid, mcode, opid in matrix_raw:
            key = (sl if sl is not None else 0, code or "", name or "Unspecified", mid or 0, opid or "")
            row = by_defect.setdefault(
                key, {"sl": sl, "defect_code": code, "defect_name": name or "Unspecified",
                      "machin_id": mid, "machin_code": mcode or "", "operator_id": opid or "",
                      "by_hour": {}, "total": 0}
            )
            if int(qty):
                row["by_hour"][str(int(h))] = row["by_hour"].get(str(int(h)), 0) + int(qty)
                row["total"] += int(qty)
        defect_rows = sorted(
            (r for r in by_defect.values() if r["total"] > 0),
            key=lambda r: (r["sl"] is None, r["sl"] or 0, r.get("machin_id") or 0),
        )

        summary = {
            str(h): {"checked": 0, "passed": 0, "defect": 0, "reject": 0, "repaired": 0, "found": 0}
            for h in hours
        }
        bundle_qty_seen: dict[str, int] = {}
        for bundle_id, h, q, p, dq, rj, d2p, r2p, qc in bundles:
            hkey = str(int(h))
            if hkey not in summary:
                summary[hkey] = {"checked": 0, "passed": 0, "defect": 0, "reject": 0, "repaired": 0, "found": 0}
            q, p, dq = int(q or 0), int(p or 0), int(dq or 0)
            rj, d2p, r2p = int(rj or 0), int(d2p or 0), int(r2p or 0)
            # checked = pieces inspected in this save (its own hour);
            # legacy rows without qc_check: bundle qty once at first save
            qc = int(qc or 0)
            if qc == 0:
                prev_q = bundle_qty_seen.get(str(bundle_id), 0)
                if q > prev_q:
                    qc = q - prev_q
                    bundle_qty_seen[str(bundle_id)] = q
            summary[hkey]["checked"] += qc
            summary[hkey]["passed"] += p
            summary[hkey]["found"] += dq         # defects found this hour
            summary[hkey]["repaired"] += d2p     # defect pieces repaired → pass
            summary[hkey]["defect"] += dq        # total defects found
            summary[hkey]["reject"] += rj - r2p
        for v in summary.values():
            v["defect"] = max(0, v["defect"])
            v["reject"] = max(0, v["reject"])

        totals = {
            "checked": sum(v["checked"] for v in summary.values()),
            "passed": sum(v["passed"] for v in summary.values()),
            "defect": sum(v["defect"] for v in summary.values()),
            "reject": sum(v["reject"] for v in summary.values()),
            "found": sum(v["found"] for v in summary.values()),
            "repaired": sum(v["repaired"] for v in summary.values()),
        }
        totals["defect_pct"] = (
            round(totals["defect"] * 100.0 / totals["checked"], 2)
            if totals["checked"]
            else 0.0
        )

        return Response(
            {
                "date": str(d),
                "floor": floor,
                "line": line,
                "line_label": names.get(line) or f"L{line}",
                "lines": lines,
                "header": {"buyer": hb[0], "style": hb[1], "unit": hb[2]},
                "hours": hours,
                "defect_rows": defect_rows,
                "summary": summary,
                "totals": totals,
            }
        )


class DayEfficiencyReportView(APIView):
    """GET /api/reports/day_efficiency/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    Day efficiency report — one row per tracked line per day, modelled on
    the ERP "Day efficiency report" sheet but built from this system's
    own data:

      plan   — pt_sewing_daily_line_targets (worker / MO / HP / IM,
               working hours, target qty) + daily_line_style_targets
               styles; SMV from mr_style (production_smv, stl_smv)
      actual — SEWING-department staff punches (present manpower and
               man hours with the 1h lunch break deducted) and QC output
               (day_qc_diffect pass qty, style-wise)

      Plan man hour  = plan worker × plan WH
      Plan SAH       = plan target × SMV / 60
      Day SAH        = Σ style output × style SMV / 60
      Efficiency %   = Day SAH / day man hours
      Achievement %  = output / plan target
    """

    MAX_DAYS = 31

    def get(self, request):
        from datetime import timedelta

        from django.db import connections

        from mbm_automation.line_dashboard_views import staff_punch_summary
        from mbm_automation.models import LineLayout

        today = get_today()
        d_from = _parse_date(request.query_params.get("date_from"), today)
        d_to = _parse_date(request.query_params.get("date_to"), d_from)
        if d_to < d_from:
            d_from, d_to = d_to, d_from
        if (d_to - d_from).days >= self.MAX_DAYS:
            d_to = d_from + timedelta(days=self.MAX_DAYS - 1)
        days = [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]

        layout = list(LineLayout.objects.all().values("floor", "line_no", "machin_no"))
        line_keys = sorted({(r["floor"], r["line_no"]) for r in layout})
        machines_by_line = {
            key: {str(r["machin_no"]) for r in layout if (r["floor"], r["line_no"]) == key}
            for key in line_keys
        }
        line_ids = sorted({ln for _, ln in line_keys})

        # --- ERP: line/floor names + plan rows + plan styles ----------------
        line_names: dict[int, str] = {}
        floor_names: dict[int, str] = {}
        plans: dict[tuple[int, str], dict] = {}
        if line_ids:
            try:
                with connections["cuttingedge"].cursor() as cursor:
                    marks = ", ".join(["%s"] * len(line_ids))
                    cursor.execute(
                        f"SELECT l.hr_line_id, l.hr_line_name, f.hr_floor_name "
                        f"FROM hr_line l LEFT JOIN hr_floor f ON f.hr_floor_id = l.hr_line_floor_id "
                        f"WHERE l.hr_line_id IN ({marks})",
                        line_ids,
                    )
                    for lid, lname, fname in cursor.fetchall():
                        line_names[int(lid)] = str(lname or "").strip()
                        floor_names[int(lid)] = str(fname or "").strip()
                    cursor.execute(
                        f"SELECT id, hr_line_id, production_date, target_qty, hour, "
                        f"number_worker, mo, helper, iron_man "
                        f"FROM pt_sewing_daily_line_targets "
                        f"WHERE hr_line_id IN ({marks}) AND production_date BETWEEN %s AND %s "
                        f"ORDER BY id",
                        [*line_ids, d_from, d_to],
                    )
                    pt_ids: list[int] = []
                    pt_key: dict[int, tuple[int, str]] = {}
                    for pid, lid, pdate, tqty, hrs, worker, mo, hp, im in cursor.fetchall():
                        key = (int(lid), str(pdate))
                        plans[key] = {
                            "pt_id": pid,
                            "target": int(tqty or 0),
                            "wh": float(hrs or 0),
                            "worker": int(float(worker or 0)),
                            "mo": int(mo or 0),
                            "hp": int(hp or 0),
                            "im": int(im or 0),
                            "styles": [],
                        }
                        pt_ids.append(pid)
                        pt_key[pid] = key
                    if pt_ids:
                        pmarks = ", ".join(["%s"] * len(pt_ids))
                        cursor.execute(
                            f"SELECT pt_sewing_id, stl_no FROM daily_line_style_targets "
                            f"WHERE pt_sewing_id IN ({pmarks}) AND deleted_at IS NULL",
                            pt_ids,
                        )
                        for pid, stl in cursor.fetchall():
                            key = pt_key.get(int(pid))
                            name = (stl or "").strip()
                            if key and name and name not in plans[key]["styles"]:
                                plans[key]["styles"].append(name)
            except Exception:
                pass

        # --- QC output per date/line/style (pass qty per save) --------------
        out_by_day_line: dict[tuple[str, int], dict[str, int]] = {}
        single_line = line_keys[0] if len(line_keys) == 1 else None
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT date, floor, line, COALESCE(style, ''), bundle_id, created_at, "
                "MAX(pass_qty) FROM day_qc_diffect "
                "WHERE date BETWEEN %s AND %s "
                "GROUP BY date, floor, line, style, bundle_id, created_at",
                [d_from, d_to],
            )
            for dkey, fl, ln, stl, _bid, _cat, pq in cursor.fetchall():
                fl, ln = int(fl or 0), int(ln or 0)
                if (fl, ln) not in machines_by_line:
                    if single_line is None:
                        continue
                    fl, ln = single_line
                day_line = out_by_day_line.setdefault((str(dkey), ln), {})
                stl = (stl or "").strip()
                day_line[stl] = day_line.get(stl, 0) + int(pq or 0)

        # --- SMV per style (plan styles + output styles, one query) ---------
        all_styles = sorted(
            {s for p in plans.values() for s in p["styles"]}
            | {s for d in out_by_day_line.values() for s in d if s}
        )
        smv_map: dict[str, float] = {}
        if all_styles:
            try:
                with connections["cuttingedge"].cursor() as cursor:
                    smarks = ", ".join(["%s"] * len(all_styles))
                    cursor.execute(
                        f"SELECT stl_no, COALESCE(production_smv, stl_smv, 0) "
                        f"FROM mr_style WHERE stl_no IN ({smarks})",
                        all_styles,
                    )
                    for stl, smv in cursor.fetchall():
                        v = float(smv or 0)
                        if v > 0:
                            smv_map[str(stl).strip()] = v
            except Exception:
                pass

        # --- rows: one per day per line --------------------------------------
        rows: list[dict] = []
        for d in days:
            dkey = d.isoformat()
            punches, _ = staff_punch_summary(d)
            for floor, line_no in line_keys:
                plan = plans.get((line_no, dkey), {})
                out_styles = out_by_day_line.get((dkey, line_no), {})
                output = sum(out_styles.values())

                style_names = plan.get("styles") or sorted(s for s in out_styles if s)
                # SMV from every style we can resolve (QC output styles often
                # match mr_style when the plan style string does not)
                known = [
                    smv_map[s]
                    for s in {*style_names, *(s for s in out_styles if s)}
                    if s in smv_map
                ]
                avg_smv = sum(known) / len(known) if known else 0.0
                day_sah = sum(
                    qty * smv_map.get(stl, avg_smv) for stl, qty in out_styles.items()
                ) / 60.0

                mids = machines_by_line[(floor, line_no)]
                staff_rows = [r for m, lst in punches.items() if m in mids for r in lst]
                present_mp = len(staff_rows)
                man_hours = sum(r["actual_seconds"] for r in staff_rows) / 3600.0

                worker = plan.get("worker", 0)
                wh = plan.get("wh", 0.0)
                target = plan.get("target", 0)
                plan_man_hour = worker * wh
                plan_sah = target * avg_smv / 60.0

                if not (plan or output or present_mp):
                    continue
                rows.append(
                    {
                        "date": dkey,
                        "floor": floor_names.get(line_no) or str(floor),
                        "line": line_names.get(line_no) or str(line_no),
                        "styles": ", ".join(style_names) or "—",
                        "smv": round(avg_smv, 2),
                        "plan_mp": worker,
                        "plan_mo": plan.get("mo", 0),
                        "plan_hp": plan.get("hp", 0),
                        "plan_im": plan.get("im", 0),
                        "plan_total_mp": worker + plan.get("mo", 0) + plan.get("hp", 0) + plan.get("im", 0),
                        "plan_target": target,
                        "plan_wh": round(wh, 1),
                        "plan_man_hour": round(plan_man_hour, 1),
                        "plan_sah": round(plan_sah, 2),
                        "plan_eff_pct": round(plan_sah / plan_man_hour * 100, 2) if plan_man_hour else 0.0,
                        "present_mp": present_mp,
                        "day_man_hour": round(man_hours, 2),
                        "output": output,
                        "day_sah": round(day_sah, 2),
                        "eff_pct": round(day_sah / man_hours * 100, 2) if man_hours else 0.0,
                        "ach_pct": round(output / target * 100, 1) if target else 0.0,
                    }
                )

        tot_man_hours = sum(r["day_man_hour"] for r in rows)
        tot_day_sah = sum(r["day_sah"] for r in rows)
        tot_plan_mh = sum(r["plan_man_hour"] for r in rows)
        tot_plan_sah = sum(r["plan_sah"] for r in rows)
        tot_target = sum(r["plan_target"] for r in rows)
        tot_output = sum(r["output"] for r in rows)
        totals = {
            "plan_mp": sum(r["plan_mp"] for r in rows),
            "plan_total_mp": sum(r["plan_total_mp"] for r in rows),
            "plan_target": tot_target,
            "plan_man_hour": round(tot_plan_mh, 1),
            "plan_sah": round(tot_plan_sah, 2),
            "plan_eff_pct": round(tot_plan_sah / tot_plan_mh * 100, 2) if tot_plan_mh else 0.0,
            "present_mp": sum(r["present_mp"] for r in rows),
            "day_man_hour": round(tot_man_hours, 2),
            "output": tot_output,
            "day_sah": round(tot_day_sah, 2),
            "eff_pct": round(tot_day_sah / tot_man_hours * 100, 2) if tot_man_hours else 0.0,
            "ach_pct": round(tot_output / tot_target * 100, 1) if tot_target else 0.0,
        }
        return Response(
            {"from": str(d_from), "to": str(d_to), "rows": rows, "totals": totals}
        )
