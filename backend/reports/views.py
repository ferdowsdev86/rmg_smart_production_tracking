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
