"""Hourly production dashboard on day_qc_diffect.

GET    /api/automation/hourly_production/?date=YYYY-MM-DD
       → matrix rows (buyer, style, po × hour → production = pass qty per
         save), grand summary (checked / pass / defect / reject) and the
         day's MANUAL entries (machin_code='MANUAL') for the CRUD list.
POST   {date, hour, buyer, style, po, qty}        → add a manual hourly entry
PUT    {id, hour?, buyer?, style?, po?, qty?}     → edit a manual entry
DELETE ?id=                                        → remove a manual entry

Only rows created here (machin_code='MANUAL') can be edited or deleted —
device/QC-saved history is never touched.
"""

from __future__ import annotations

from datetime import datetime

from django.db import connections
from rest_framework.response import Response
from rest_framework.views import APIView

from mbm_automation.day_sew_target_views import _parse_on_date

MANUAL_MARK = "MANUAL"


def _default_floor_line() -> tuple[int, int]:
    try:
        from mbm_automation.models import LineLayout

        lines = list(LineLayout.objects.values_list("floor", "line_no").distinct())
        if len(lines) == 1:
            return int(lines[0][0] or 0), int(lines[0][1] or 0)
    except Exception:
        pass
    return 0, 0


class HourlyProductionView(APIView):
    def get(self, request):
        on_date = _parse_on_date(request.query_params.get("date"))
        with connections["default"].cursor() as cursor:
            # production per buyer/style/po per hour — one save counted once
            cursor.execute(
                "SELECT line, buyer, style, po, h, SUM(p) FROM ("
                "SELECT COALESCE(line,0) line, COALESCE(buyer,'') buyer, "
                "COALESCE(style,'') style, COALESCE(po,'') po, "
                "HOUR(created_at) h, MAX(pass_qty) p "
                "FROM day_qc_diffect WHERE date = %s "
                "GROUP BY COALESCE(bcss_id, bundle_id), created_at, COALESCE(line,0), "
                "COALESCE(buyer,''), COALESCE(style,''), COALESCE(po,'')) t "
                "GROUP BY line, buyer, style, po, h",
                [on_date],
            )
            cells = cursor.fetchall()

            cursor.execute(
                "SELECT COALESCE(SUM(qc),0), COALESCE(SUM(p),0), "
                "COALESCE(SUM(dq),0), COALESCE(SUM(rq),0), COALESCE(SUM(rp),0) FROM ("
                "SELECT MAX(qc_check) qc, MAX(pass_qty) p, SUM(defect_qty) dq, "
                "MAX(reject_qty) rq, MAX(diffect_to_pass) rp "
                "FROM day_qc_diffect WHERE date = %s "
                "GROUP BY COALESCE(bcss_id, bundle_id), created_at) t",
                [on_date],
            )
            qc, p, dq, rq, rp = cursor.fetchone()

            # search/select options for the entry form: distinct buyer/style/po
            # combos seen in the last 30 days
            cursor.execute(
                "SELECT DISTINCT COALESCE(buyer,''), COALESCE(style,''), COALESCE(po,'') "
                "FROM day_qc_diffect "
                "WHERE date >= DATE_SUB(%s, INTERVAL 30 DAY) AND COALESCE(style,'') <> '' "
                "ORDER BY 2 LIMIT 300",
                [on_date],
            )
            combos = [
                {"buyer": r[0], "style": r[1], "po": r[2]} for r in cursor.fetchall()
            ]

            cursor.execute(
                "SELECT id, HOUR(created_at), COALESCE(buyer,''), COALESCE(style,''), "
                "COALESCE(po,''), pass_qty, COALESCE(line,0) FROM day_qc_diffect "
                "WHERE date = %s AND machin_code = %s ORDER BY created_at, id",
                [on_date, MANUAL_MARK],
            )
            manual = [
                {"id": r[0], "hour": int(r[1]), "buyer": r[2], "style": r[3],
                 "po": r[4], "qty": int(r[5] or 0), "line": int(r[6] or 0)}
                for r in cursor.fetchall()
            ]

            # line choices: layout lines + lines seen recently in day_qc
            cursor.execute(
                "SELECT DISTINCT line FROM day_qc_diffect "
                "WHERE date >= DATE_SUB(%s, INTERVAL 30 DAY) AND line > 0",
                [on_date],
            )
            line_opts = sorted({int(r[0]) for r in cursor.fetchall()})
        try:
            from mbm_automation.models import LineLayout

            line_opts = sorted(
                set(line_opts)
                | {int(l) for l in LineLayout.objects.values_list("line_no", flat=True)}
            )
        except Exception:
            pass
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")

        hours = list(range(8, 20))
        extra = sorted({int(c[3]) for c in cells} - set(hours))
        hours += extra

        groups: dict = {}
        for line, buyer, style, po, h, qty in cells:
            key = (int(line or 0), buyer, style, po)
            g = groups.setdefault(
                key, {"line": int(line or 0) or "—", "buyer": buyer or "—",
                      "style": style or "—", "po": po or "—",
                      "by_hour": {}, "total": 0}
            )
            q = int(qty or 0)
            if q:
                g["by_hour"][str(int(h))] = g["by_hour"].get(str(int(h)), 0) + q
                g["total"] += q

        rows = sorted(groups.values(), key=lambda g: -g["total"])
        hour_totals = {
            str(h): sum(g["by_hour"].get(str(h), 0) for g in rows) for h in hours
        }
        return Response(
            {
                "date": on_date.isoformat(),
                "hours": hours,
                "rows": rows,
                "hour_totals": hour_totals,
                "summary": {
                    "checked": int(qc), "pass": int(p), "defect": int(dq),
                    "reject": int(rq), "repaired": int(rp),
                    "production": sum(g["total"] for g in rows),
                },
                "manual": manual,
                "options": combos,
                "lines": line_opts,
            }
        )

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        on_date = _parse_on_date(data.get("date"))
        try:
            hour = int(data.get("hour"))
            qty = int(data.get("qty"))
        except (TypeError, ValueError):
            return Response({"detail": "hour and qty must be numbers."}, status=400)
        if not (0 <= hour <= 23) or qty <= 0:
            return Response({"detail": "hour must be 0-23 and qty positive."}, status=400)
        buyer = str(data.get("buyer") or "").strip()[:100]
        style = str(data.get("style") or "").strip()[:100]
        po = str(data.get("po") or "").strip()[:100]
        if not style:
            return Response({"detail": "style is required."}, status=400)
        floor, line = _default_floor_line()
        try:
            if data.get("line") not in (None, ""):
                line = int(data["line"])
        except (TypeError, ValueError):
            return Response({"detail": "line must be a number."}, status=400)
        created = datetime.combine(on_date, datetime.min.time()).replace(hour=hour)
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "INSERT INTO day_qc_diffect "
                "(date, buyer, style, po, floor, line, bundle_id, bundle_qty, "
                "pass_qty, defect_qty, reject_qty, qc_check, diffect_to_pass, "
                "reject_to_pass, machin_code, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, '', %s, %s, 0, 0, %s, 0, 0, %s, %s)",
                [on_date, buyer or None, style, po or None, floor, line,
                 qty, qty, qty, MANUAL_MARK, created.strftime("%Y-%m-%d %H:%M:%S")],
            )
            row_id = cursor.lastrowid
        return Response({"id": row_id, "date": on_date.isoformat(), "hour": hour,
                         "buyer": buyer, "style": style, "po": po, "qty": qty},
                        status=201)

    def put(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            row_id = int(data.get("id") or 0)
        except (TypeError, ValueError):
            row_id = 0
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT date, machin_code FROM day_qc_diffect WHERE id = %s", [row_id]
            )
            row = cursor.fetchone()
            if not row or (row[1] or "") != MANUAL_MARK:
                return Response({"detail": "Manual entry not found."}, status=404)
            on_date = row[0]
            sets, params = [], []
            if data.get("qty") not in (None, ""):
                qty = int(data["qty"])
                if qty <= 0:
                    return Response({"detail": "qty must be positive."}, status=400)
                sets += ["pass_qty=%s", "qc_check=%s", "bundle_qty=%s"]
                params += [qty, qty, qty]
            if data.get("hour") not in (None, ""):
                hour = int(data["hour"])
                if not (0 <= hour <= 23):
                    return Response({"detail": "hour must be 0-23."}, status=400)
                created = datetime.combine(on_date, datetime.min.time()).replace(hour=hour)
                sets.append("created_at=%s")
                params.append(created.strftime("%Y-%m-%d %H:%M:%S"))
            for field in ("buyer", "style", "po"):
                if field in data:
                    sets.append(f"{field}=%s")
                    params.append(str(data.get(field) or "").strip()[:100] or None)
            if data.get("line") not in (None, ""):
                try:
                    sets.append("line=%s")
                    params.append(int(data["line"]))
                except (TypeError, ValueError):
                    return Response({"detail": "line must be a number."}, status=400)
            if not sets:
                return Response({"detail": "Nothing to update."}, status=400)
            cursor.execute(
                f"UPDATE day_qc_diffect SET {', '.join(sets)} WHERE id=%s",
                [*params, row_id],
            )
        return Response({"updated": True, "id": row_id})

    def delete(self, request):
        rid = request.query_params.get("id") or (
            request.data.get("id") if isinstance(request.data, dict) else None
        )
        try:
            row_id = int(rid or 0)
        except (TypeError, ValueError):
            row_id = 0
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT machin_code FROM day_qc_diffect WHERE id = %s", [row_id]
            )
            row = cursor.fetchone()
            if not row or (row[0] or "") != MANUAL_MARK:
                return Response({"detail": "Manual entry not found."}, status=404)
            cursor.execute("DELETE FROM day_qc_diffect WHERE id = %s", [row_id])
        return Response({"deleted": True, "id": row_id})
