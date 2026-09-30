"""Line day dashboard — real-data feed for the Floor Dashboard page.

GET /api/automation/line_day_dashboard/?floor=1&line=1[&date=YYYY-MM-DD]

Combines:
- day_line_target      → style / target_qty / target_hour / start & break time
- machin_production_count → day qty / defect / reject (production = qty-d-r)
- sewing_log (flag9)   → hourly production buckets
- line_layout          → machines on the line
"""

from __future__ import annotations

from collections import defaultdict

from django.db import connections
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.models import DayLineTarget
from mbm_automation.bundle_barcode import bulk_qty_for_barcodes, production_qty_for_flag9
from mbm_automation.day_sew_target_views import _calc_hour_target, _parse_on_date
from mbm_automation.models import LineLayout, SewingLog
from mbm_automation.sewing_analysis import _sewing_wall_datetime


def _hour_in_break(hour: int, break_st, break_end) -> bool:
    if break_st is None or break_end is None or break_st == break_end:
        return False
    return break_st.hour <= hour < max(break_end.hour, break_st.hour + 1)


class LineDayDashboardView(APIView):
    """Aggregated line/day numbers for the Floor Dashboard hero page."""

    def get(self, request):
        try:
            floor = int(request.query_params.get("floor") or 0)
            line = int(request.query_params.get("line") or 0)
        except (TypeError, ValueError):
            return Response({"detail": "Invalid floor/line."}, status=400)
        on_date = _parse_on_date(request.query_params.get("date"))

        machines = list(
            LineLayout.objects.filter(floor=floor, line_no=line)
            .order_by("machin_no")
            .values_list("machin_no", flat=True)
        )
        if not machines:
            return Response({"detail": "Line not found in line_layout."}, status=404)

        target = (
            DayLineTarget.objects.filter(floor=floor, line=line, date=on_date)
            .order_by("-id")
            .first()
            or DayLineTarget.objects.filter(line=line, date=on_date)
            .order_by("-id")
            .first()
        )
        style = (target.style or "") if target else ""
        target_qty = int(target.target_qty or 0) if target else 0
        target_hour = int(target.target_hour or 0) if target else 0
        start_time = target.start_time if target else None
        break_st = target.break_st if target else None
        break_end = target.break_end if target else None
        layout_id = (target.layout_id or None) if target else None
        hour_target = (
            _calc_hour_target(target_qty, target_hour, break_st, break_end)
            if target
            else 0
        )

        # Day totals (QC-adjusted) from machin_production_count.
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(SUM(bundle_qty),0), COALESCE(SUM(defect),0), "
                "COALESCE(SUM(reject),0) FROM machin_production_count "
                "WHERE floor=%s AND line=%s AND date=%s",
                [floor, line, on_date],
            )
            qty, defect, reject = [int(v) for v in cursor.fetchone()]

        # Hourly production buckets from sewing_log flag9 (bundle qty / +1 pulse).
        cache: dict[str, int] = {}
        per_hour: dict[int, int] = defaultdict(int)
        logs = list(
            SewingLog.objects.filter(
                machin_id__in=list(machines), logged_at__date=on_date
            )
            .exclude(flag9__in=["", "0"])
            .values_list("logged_at", "flag9")
        )
        cache.update(bulk_qty_for_barcodes([f9 for _, f9 in logs]))
        for logged_at, flag9 in logs:
            wall = _sewing_wall_datetime(logged_at)
            hour = (wall or logged_at).hour
            per_hour[hour] += production_qty_for_flag9(flag9, cache=cache)

        start_hour = start_time.hour if start_time else 8
        slot_count = target_hour if target_hour > 0 else 10
        slot_count = min(max(slot_count, 1), 14)
        hours = []
        for i in range(slot_count):
            h = (start_hour + i) % 24
            is_break = _hour_in_break(h, break_st, break_end)
            hours.append(
                {
                    "hour": h,
                    "label": f"{h:02d}–{(h + 1) % 24:02d}",
                    "target": 0 if is_break else hour_target,
                    "actual": int(per_hour.get(h, 0)),
                    "is_break": is_break,
                }
            )
        extra = sorted(
            hh for hh in per_hour
            if hh not in {s["hour"] for s in hours} and per_hour[hh] > 0
        )
        for h in extra:
            hours.append(
                {
                    "hour": h,
                    "label": f"{h:02d}–{(h + 1) % 24:02d}",
                    "target": 0,
                    "actual": int(per_hour[h]),
                    "is_break": False,
                    "overtime": True,
                }
            )

        return Response(
            {
                "floor": floor,
                "line": line,
                "date": on_date.isoformat(),
                "style": style,
                "layout_id": layout_id,
                "target_qty": target_qty,
                "target_hour": target_hour,
                "hour_target": hour_target,
                "start_time": str(start_time) if start_time else None,
                "break_st": str(break_st) if break_st else None,
                "break_end": str(break_end) if break_end else None,
                "machine_count": len(machines),
                "machines": [int(m) for m in machines],
                "day": {
                    "qty": qty,
                    "defect": defect,
                    "reject": reject,
                    "production": max(0, qty - defect - reject),
                },
                "hours": hours,
            }
        )


class FloorOverviewView(APIView):
    """GET /api/automation/floor_overview/?date= — factory-wide live
    production & quality dashboard in ONE response:
    per-line performance, hourly buckets, quality summary, machine
    quality ranking, NPT by category. All from real tables."""

    def get(self, request):
        on_date = _parse_on_date(request.query_params.get("date"))
        start_hour = 8

        layout = list(
            LineLayout.objects.all().values("floor", "line_no", "machin_no")
        )
        line_keys = sorted({(r["floor"], r["line_no"]) for r in layout})
        machines_by_line = {
            key: sorted(r["machin_no"] for r in layout if (r["floor"], r["line_no"]) == key)
            for key in line_keys
        }
        all_machines = sorted({r["machin_no"] for r in layout})

        # --- ERP line names + day targets (one query each) -----------------
        line_ids = sorted({ln for _, ln in line_keys})
        names: dict[int, str] = {}
        targets: dict[int, dict] = {}
        try:
            with connections["cuttingedge"].cursor() as cursor:
                marks = ", ".join(["%s"] * len(line_ids))
                cursor.execute(
                    f"SELECT hr_line_id, hr_line_name FROM hr_line WHERE hr_line_id IN ({marks})",
                    line_ids,
                )
                names = {int(r[0]): str(r[1] or "").strip() for r in cursor.fetchall()}
                cursor.execute(
                    f"SELECT p.hr_line_id, p.id, p.target_qty, p.hour, p.layout_id "
                    f"FROM pt_sewing_daily_line_targets p "
                    f"WHERE p.hr_line_id IN ({marks}) AND p.production_date = %s "
                    f"ORDER BY p.id",
                    [*line_ids, on_date],
                )
                pt_ids = []
                for hr_id, pt_id, tqty, thour, lay in cursor.fetchall():
                    targets[int(hr_id)] = {
                        "pt_id": pt_id,
                        "target_qty": int(tqty or 0),
                        "hours": float(thour or 0),
                        "layout_id": lay,
                        "styles": [],
                    }
                    pt_ids.append(pt_id)
                if pt_ids:
                    pmarks = ", ".join(["%s"] * len(pt_ids))
                    cursor.execute(
                        f"SELECT pt_sewing_id, stl_no FROM daily_line_style_targets "
                        f"WHERE pt_sewing_id IN ({pmarks}) AND deleted_at IS NULL",
                        pt_ids,
                    )
                    by_pt: dict[int, list[str]] = defaultdict(list)
                    for pid, stl in cursor.fetchall():
                        name = (stl or "").strip()
                        if name and name not in by_pt[pid]:
                            by_pt[pid].append(name)
                    for t in targets.values():
                        t["styles"] = by_pt.get(t["pt_id"], [])
        except Exception:
            pass

        # --- production counts per machine (one query) ----------------------
        per_machine: dict[int, dict] = {}
        if all_machines:
            mmarks = ", ".join(["%s"] * len(all_machines))
            with connections["default"].cursor() as cursor:
                cursor.execute(
                    f"SELECT machin_id, COALESCE(SUM(bundle_qty),0), "
                    f"COALESCE(SUM(defect),0), COALESCE(SUM(reject),0), "
                    f"COALESCE(SUM(CASE WHEN qc_checked=1 "
                    f"THEN bundle_qty - defect - reject ELSE 0 END),0) "
                    f"FROM machin_production_count "
                    f"WHERE machin_id IN ({mmarks}) AND date = %s GROUP BY machin_id",
                    [*all_machines, on_date],
                )
                for mid, q, d, r, p in cursor.fetchall():
                    per_machine[int(mid)] = {
                        "scanned": int(q),
                        "defect": int(d),
                        "reject": int(r),
                        "passed": max(0, int(p)),
                    }

        # --- hourly buckets + active stations from sewing_log --------------
        cache: dict[str, int] = {}
        hour_actual: dict[int, int] = defaultdict(int)
        machine_hour: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        last_flag3: dict[int, int] = {}
        logs = list(
            SewingLog.objects.filter(
                machin_id__in=all_machines, logged_at__date=on_date
            ).order_by("id").values_list("machin_id", "logged_at", "flag3", "flag9")
        )
        # ONE batch query for every barcode's qty instead of a per-barcode
        # ERP lookup (which timed out once a day had a few hundred scans).
        cache.update(bulk_qty_for_barcodes([f9 for _, _, _, f9 in logs]))
        for mid, logged_at, flag3, flag9 in logs:
            last_flag3[int(mid)] = int(flag3 or 0)
            key = (flag9 or "").strip() if isinstance(flag9, str) else str(flag9 or "")
            if key not in ("", "0"):
                wall = _sewing_wall_datetime(logged_at)
                hour = (wall or logged_at).hour
                pieces = production_qty_for_flag9(flag9, cache=cache)
                hour_actual[hour] += pieces
                machine_hour[int(mid)][hour] += pieces

        # --- QC numbers from day_qc_diffect (matches the Quality report) -----
        # output  = SUM(pass_qty)                       (per-save, unit/date wise)
        # defect  = SUM(defect_qty)  (total defects found; repairs shown separately)
        # reject  = SUM(reject_qty)  - SUM(reject_to_pass)
        # Rows written by one save share bundle_id + created_at, so group per
        # save first (pass/reject/to_pass repeat on every row of a save).
        qc_line: dict = {}
        qc_tot = {"checked": 0, "passed": 0, "defect": 0, "reject": 0}
        qc_hour_pass: dict[int, int] = defaultdict(int)
        bundle_qty_seen: dict[tuple, int] = {}
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute(
                    "SELECT floor, line, bundle_id, MAX(bundle_qty), "
                    "MAX(pass_qty), COALESCE(SUM(defect_qty), 0), "
                    "MAX(reject_qty), COALESCE(MAX(diffect_to_pass), 0), "
                    "COALESCE(MAX(reject_to_pass), 0), HOUR(created_at), "
                    "COALESCE(MAX(qc_check), 0) "
                    "FROM day_qc_diffect WHERE date = %s "
                    "GROUP BY floor, line, bundle_id, created_at",
                    [on_date],
                )
                single_line = line_keys[0] if len(line_keys) == 1 else None
                for fl, ln, bid, q, pq, d, rj, d2p, r2p, qh, qc in cursor.fetchall():
                    key = (int(fl or 0), int(ln or 0))
                    # QC rows without a station scan (0,0) belong to the only line
                    if key == (0, 0) and single_line is not None:
                        key = (int(single_line[0]), int(single_line[1]))
                    st = qc_line.setdefault(
                        key, {"checked": 0, "passed": 0, "defect": 0, "reject": 0}
                    )
                    q, pq, d = int(q or 0), int(pq or 0), int(d or 0)
                    rj, d2p, r2p = int(rj or 0), int(d2p or 0), int(r2p or 0)
                    # checked = pieces inspected in each save (qc_check);
                    # legacy rows without qc_check fall back to bundle qty once
                    qc = int(qc or 0)
                    if qc == 0:
                        bkey = (key, str(bid))
                        prev_q = bundle_qty_seen.get(bkey, 0)
                        if q > prev_q:
                            qc = q - prev_q
                            bundle_qty_seen[bkey] = q
                    st["checked"] += qc
                    qc_tot["checked"] += qc
                    st["passed"] += pq
                    st["defect"] += d            # total defects FOUND (repairs not deducted)
                    st["reject"] += rj - r2p
                    qc_tot["passed"] += pq
                    qc_tot["defect"] += d
                    qc_tot["reject"] += rj - r2p
                    # hourly PASS bucket (hour this save happened)
                    qc_hour_pass[int(qh or 0)] += pq
            for st in list(qc_line.values()) + [qc_tot]:
                st["defect"] = max(0, st["defect"])
                st["reject"] = max(0, st["reject"])
        except Exception:
            pass

        # --- per line rollup -------------------------------------------------
        lines_out = []
        for floor, line_no in line_keys:
            machines = machines_by_line[(floor, line_no)]
            t = targets.get(int(line_no), {})
            scanned = sum(per_machine.get(m, {}).get("scanned", 0) for m in machines)
            # Quality numbers come from day_qc_diffect — the same source as
            # the Quality report, so both always agree.
            qc = qc_line.get(
                (floor, line_no), {"checked": 0, "passed": 0, "defect": 0, "reject": 0}
            )
            defect = qc["defect"]
            reject = qc["reject"]
            checked = qc["checked"]
            # Line OUTPUT = quality-PASSED pieces only.
            output = qc["passed"]
            tq = t.get("target_qty", 0)
            hours = t.get("hours", 0)
            lines_out.append(
                {
                    "floor": floor,
                    "line": line_no,
                    "label": names.get(int(line_no)) or f"L{line_no}",
                    "style": ", ".join(t.get("styles", [])),
                    "target_qty": tq,
                    "hours": hours,
                    "hour_target": int(round(tq / hours)) if tq and hours else 0,
                    "layout_id": t.get("layout_id"),
                    "scanned": scanned,
                    "checked": checked,
                    "defect": defect,
                    "reject": reject,
                    "output": output,
                    "ach_pct": round(output / tq * 100, 1) if tq else 0.0,
                    "rft_pct": round(output / checked * 100, 1) if checked else 100.0,
                    "dhu_pct": round(defect / checked * 100, 2) if checked else 0.0,
                    "reject_pct": round(reject / checked * 100, 2) if checked else 0.0,
                    "active_stations": sum(
                        1 for m in machines if last_flag3.get(m, 0) != 0
                    ),
                    "station_count": len(machines),
                }
            )

        # --- totals -----------------------------------------------------------
        T = {
            "target": sum(l["target_qty"] for l in lines_out),
            "scanned": sum(l["scanned"] for l in lines_out),
            "checked": qc_tot["checked"],
            "passed": qc_tot["passed"],
            "output": qc_tot["passed"],
            "defect": qc_tot["defect"],
            "reject": qc_tot["reject"],
            "active_stations": sum(l["active_stations"] for l in lines_out),
            "station_count": sum(l["station_count"] for l in lines_out),
        }
        T["ach_pct"] = round(T["output"] / T["target"] * 100, 1) if T["target"] else 0.0
        T["rft_pct"] = (
            round(T["passed"] / T["checked"] * 100, 1) if T["checked"] else 100.0
        )
        T["dhu_pct"] = round(T["defect"] / T["checked"] * 100, 2) if T["checked"] else 0.0
        T["reject_pct"] = (
            round(T["reject"] / T["checked"] * 100, 2) if T["checked"] else 0.0
        )

        # --- hourly table (targets = sum of line hour targets) ----------------
        slot_count = int(max((l["hours"] for l in lines_out if l["hours"]), default=10))
        slot_count = min(max(slot_count, 1), 14)
        hour_target_sum = sum(l["hour_target"] for l in lines_out)
        hourly = []
        for i in range(slot_count):
            h = (start_hour + i) % 24
            hourly.append(
                {
                    "hour": h,
                    "label": f"{h:02d}–{(h + 1) % 24:02d}",
                    "target": hour_target_sum,
                    # QC-passed pieces in this hour (day_qc_diffect.created_at)
                    "actual": int(qc_hour_pass.get(h, 0)),
                    "scanned": int(hour_actual.get(h, 0)),
                }
            )
        covered = {s["hour"] for s in hourly}
        for h in sorted(set(hour_actual) | set(qc_hour_pass)):
            if h not in covered and (hour_actual.get(h, 0) > 0 or qc_hour_pass.get(h, 0) > 0):
                hourly.append(
                    {
                        "hour": h,
                        "label": f"{h:02d}–{(h + 1) % 24:02d}",
                        "target": 0,
                        "actual": int(qc_hour_pass.get(h, 0)),
                        "scanned": int(hour_actual.get(h, 0)),
                        "overtime": True,
                    }
                )

        # --- machine quality ranking ------------------------------------------
        machine_rank = sorted(
            (
                {
                    "machin_id": m,
                    **per_machine.get(m, {"scanned": 0, "defect": 0, "reject": 0}),
                    "dhu_pct": round(
                        per_machine.get(m, {}).get("defect", 0)
                        / per_machine.get(m, {}).get("scanned", 1)
                        * 100,
                        2,
                    )
                    if per_machine.get(m, {}).get("scanned", 0)
                    else 0.0,
                }
                for m in all_machines
            ),
            key=lambda r: (-r["dhu_pct"], -r["defect"]),
        )

        # --- NPT: summary + category / station breakdown + event rows -----------
        npt_categories: list[dict] = []
        npt_machines: list[dict] = []
        npt_rows: list[dict] = []
        npt_total_min = 0
        npt_events = 0
        npt_open = 0
        try:
            from mbm_automation.daily_npt_views import _merged_results

            by_cat: dict[str, float] = defaultdict(float)
            cat_events: dict[str, int] = defaultdict(int)
            by_machine: dict[int, float] = defaultdict(float)
            for row in _merged_results(on_date):
                mins = float(row.get("npt_hour") or 0) * 60
                cat = (row.get("category") or "Other").strip() or "Other"
                by_cat[cat] += mins
                cat_events[cat] += 1
                by_machine[int(row.get("machin_id") or 0)] += mins
                npt_events += 1
                if row.get("is_open"):
                    npt_open += 1
                npt_rows.append(
                    {
                        "machin_id": row.get("machin_id"),
                        "category": cat,
                        "reason": (row.get("npt_reason") or "").strip(),
                        "start_at": str(row.get("start_at") or "")[-8:],
                        "stop_at": str(row.get("stop_at") or "")[-8:],
                        "minutes": int(round(mins)),
                        "is_open": bool(row.get("is_open")),
                    }
                )
            npt_categories = [
                {"category": k, "minutes": int(round(v)), "events": cat_events[k]}
                for k, v in sorted(by_cat.items(), key=lambda x: -x[1])
            ]
            npt_machines = [
                {"machin_id": m, "minutes": int(round(v))}
                for m, v in sorted(by_machine.items(), key=lambda x: -x[1])
                if v > 0
            ]
            npt_rows.sort(key=lambda r: (-r["is_open"], -r["minutes"]))
            npt_total_min = int(round(sum(by_cat.values())))
        except Exception:
            pass

        # --- realtime line efficiency (SMV based) -------------------------------
        # efficiency% = earned minutes / available minutes × 100
        #   earned    = Σ (style-wise QC output × style SMV from mr_style)
        #   available = manpower (active stations) × worked minutes so far
        efficiency = {"pct": 0.0, "smv": 0.0, "earned_min": 0, "avail_min": 0,
                      "manpower": 0, "worked_min": 0}
        try:
            from zoneinfo import ZoneInfo

            from django.utils import timezone as _tz

            style_out: dict[str, int] = defaultdict(int)
            with connections["default"].cursor() as cursor:
                cursor.execute(
                    "SELECT COALESCE(style, ''), MAX(pass_qty) "
                    "FROM day_qc_diffect WHERE date = %s "
                    "GROUP BY style, bundle_id, created_at",
                    [on_date],
                )
                for stl, pq in cursor.fetchall():
                    style_out[(stl or "").strip()] += int(pq or 0)
            smv_map: dict[str, float] = {}
            style_names = [s for s in style_out if s]
            if style_names:
                with connections["cuttingedge"].cursor() as cursor:
                    smarks = ", ".join(["%s"] * len(style_names))
                    cursor.execute(
                        f"SELECT stl_no, COALESCE(production_smv, stl_smv, 0) "
                        f"FROM mr_style WHERE stl_no IN ({smarks})",
                        style_names,
                    )
                    for stl, smv in cursor.fetchall():
                        v = float(smv or 0)
                        if v > 0:
                            smv_map[str(stl).strip()] = v
            avg_smv = (sum(smv_map.values()) / len(smv_map)) if smv_map else 0.0
            earned = sum(
                qty * smv_map.get(stl, avg_smv) for stl, qty in style_out.items()
            )
            # Line manpower for efficiency — fixed 45 (override via env
            # LINE_EFFICIENCY_MANPOWER when the line size changes).
            from core.env import config as _cfg

            try:
                manpower = int(_cfg("LINE_EFFICIENCY_MANPOWER", default="45"))
            except (TypeError, ValueError):
                manpower = 45
            day_hours = (
                max((float(t.get("hours") or 0) for t in targets.values()), default=0)
                if targets else 0
            )
            day_min = int((day_hours or 10) * 60)
            now_dhk = _tz.now().astimezone(ZoneInfo("Asia/Dhaka"))
            if str(on_date) == now_dhk.date().isoformat():
                start_dt = now_dhk.replace(
                    hour=start_hour, minute=0, second=0, microsecond=0
                )
                worked = int((now_dhk - start_dt).total_seconds() // 60)
                worked = max(0, min(worked, day_min))
            else:
                worked = day_min
            avail = manpower * worked
            efficiency = {
                "pct": round(earned / avail * 100, 1) if avail > 0 else 0.0,
                "smv": round(avg_smv, 2),
                "earned_min": int(round(earned)),
                "avail_min": int(avail),
                "manpower": manpower,
                "worked_min": worked,
            }
        except Exception:
            pass

        # --- last-hour performers: good (top output, no defect) vs bad ----------
        # Photo / name from ERP HR (hr_as_basic_info via sewing_log RFID login).
        performers = {"hour": None, "good": [], "bad": []}
        try:
            last_hour = max(
                (h for m in all_machines for h, v in machine_hour[m].items() if v > 0),
                default=None,
            )
            if last_hour is not None:
                from mbm_automation.sewing_analysis import resolve_active_machin_user

                def _hr_person(mid: int) -> dict:
                    op = ""
                    try:
                        op = resolve_active_machin_user(int(mid), on_date) or ""
                    except Exception:
                        pass
                    name = pic = assoc = None
                    if op:
                        try:
                            with connections["cuttingedge"].cursor() as cur:
                                cur.execute(
                                    "SELECT as_name, associate_id, as_pic "
                                    "FROM hr_as_basic_info "
                                    "WHERE as_rfid_code = %s AND deleted_at IS NULL "
                                    "ORDER BY as_id DESC LIMIT 1",
                                    [op],
                                )
                                row = cur.fetchone()
                                if row:
                                    name, assoc, pic = row[0], row[1], row[2]
                        except Exception:
                            pass
                    return {
                        "operator_id": op,
                        "name": name,
                        "associate_id": assoc,
                        "photo": pic,
                    }

                stats = []
                for m in all_machines:
                    pieces_last = int(machine_hour[m].get(last_hour, 0))
                    day_total = int(sum(machine_hour[m].values()))
                    defect = int(per_machine.get(m, {}).get("defect", 0))
                    if day_total > 0 or defect > 0:
                        stats.append(
                            {
                                "machin_id": int(m),
                                "pieces": pieces_last,
                                "day_total": day_total,
                                "defect": defect,
                            }
                        )
                hh = f"{int(last_hour):02d}"
                used: set = set()
                good: list[dict] = []
                bad: list[dict] = []
                for s in sorted(
                    (s for s in stats if s["defect"] == 0 and s["pieces"] > 0),
                    key=lambda s: -s["pieces"],
                )[:2]:
                    good.append(
                        {**s, **_hr_person(s["machin_id"]),
                         "reason": f"Top output {s['pieces']} pcs in {hh}h · 0 defect"}
                    )
                    used.add(s["machin_id"])
                for s in sorted(
                    (s for s in stats if s["defect"] > 0), key=lambda s: -s["defect"]
                )[:2]:
                    bad.append(
                        {**s, **_hr_person(s["machin_id"]),
                         "reason": f"High defect · {s['defect']} pcs today"}
                    )
                    used.add(s["machin_id"])
                if len(bad) < 2:
                    for s in sorted(
                        (s for s in stats if s["machin_id"] not in used),
                        key=lambda s: s["pieces"],
                    )[: 2 - len(bad)]:
                        if good and s["pieces"] >= good[0]["pieces"]:
                            continue
                        bad.append(
                            {**s, **_hr_person(s["machin_id"]),
                             "reason": f"Low output · {s['pieces']} pcs in {hh}h"}
                        )
                performers = {"hour": int(last_hour), "good": good, "bad": bad}
        except Exception:
            pass

        # --- per-machine hourly output matrix ---------------------------------
        machine_hours = [
            {
                "machin_id": int(m),
                "by_hour": {str(h): int(v) for h, v in sorted(machine_hour[m].items())},
                "total": int(sum(machine_hour[m].values())),
            }
            for m in all_machines
        ]

        from django.utils import timezone as _tz

        return Response(
            {
                "date": on_date.isoformat(),
                "generated_at": _tz.now().isoformat(),
                "totals": T,
                "lines": lines_out,
                "hourly": hourly,
                "machines": machine_rank,
                "machine_hours": machine_hours,
                "performers": performers,
                "efficiency": efficiency,
                "npt": {
                    "categories": npt_categories,
                    "total_minutes": npt_total_min,
                    "events": npt_events,
                    "open_events": npt_open,
                    "machines": npt_machines,
                    "rows": npt_rows[:8],
                },
            }
        )


class FloorOverviewDetailView(APIView):
    """GET /api/automation/floor_overview_detail/?kind=output|defect|reject[&date=]

    Drill-down lists behind the dashboard KPI cards, all from day_qc_diffect:
    - output: per style/order/po — qty, pass, defect, reject
    - defect: per process(part)/bundle/defect type — pcs, machine, operator, hour
    - reject: per bundle with rejected pieces
    """

    def get(self, request):
        kind = (request.query_params.get("kind") or "output").strip().lower()
        on_date = _parse_on_date(request.query_params.get("date"))

        with connections["default"].cursor() as cursor:
            if kind == "defect":
                cursor.execute(
                    "SELECT d.part_no, d.bundle_id, h.diffect_code, h.diffect_name, "
                    "COALESCE(SUM(h.diffect_qty),0), MAX(d.machin_id), MAX(d.machin_code), "
                    "MAX(d.operator_id), HOUR(MIN(h.created_at)), MAX(d.style) "
                    "FROM hour_quality_diffect h "
                    "JOIN day_qc_diffect d ON d.id = h.day_qc_diffect_id "
                    "WHERE d.date = %s AND h.diffect_qty > 0 "
                    "GROUP BY d.part_no, d.bundle_id, h.diffect_code, h.diffect_name "
                    "ORDER BY 5 DESC",
                    [on_date],
                )
                rows = [
                    {
                        "process": r[0] or "—",
                        "bundle_id": r[1],
                        "defect_code": r[2] or "—",
                        "defect_name": r[3] or "Unspecified",
                        "pcs": int(r[4]),
                        "machin_id": r[5],
                        "machin_code": r[6] or "",
                        "operator_id": r[7] or "",
                        "hour": f"{int(r[8]):02d}–{(int(r[8]) + 1) % 24:02d}" if r[8] is not None else "—",
                        "style": r[9] or "—",
                    }
                    for r in cursor.fetchall()
                ]
                return Response({"kind": kind, "date": str(on_date), "rows": rows})

            # bundle-level state (shared by output / reject):
            # per-save rows first (pass/reject/to_pass repeat per row of one
            # save), then rolled up per bundle in Python.
            cursor.execute(
                "SELECT bundle_id, MAX(style), MAX(part_no), MAX(bundle_qty), "
                "MAX(pass_qty), COALESCE(SUM(defect_qty), 0), MAX(reject_qty), "
                "COALESCE(MAX(diffect_to_pass), 0), COALESCE(MAX(reject_to_pass), 0) "
                "FROM day_qc_diffect WHERE date = %s "
                "GROUP BY bundle_id, created_at",
                [on_date],
            )
            per_bundle: dict[str, dict] = {}
            for bid, style, part, q, pq, d, rj, d2p, r2p in cursor.fetchall():
                b = per_bundle.setdefault(
                    str(bid),
                    {"style": style, "part": part, "qty": 0, "pass": 0,
                     "defect": 0, "reject": 0},
                )
                b["style"] = b["style"] or style
                b["part"] = b["part"] or part
                b["qty"] = max(b["qty"], int(q or 0))
                b["pass"] += int(pq or 0)
                b["defect"] += int(d or 0)  # defects found
                b["reject"] += int(rj or 0) - int(r2p or 0)
            bundles = [
                (bid, b["style"], b["part"], b["qty"], b["pass"],
                 max(0, b["reject"]), max(0, b["defect"]))
                for bid, b in per_bundle.items()
            ]

            po_map: dict[str, tuple] = {}
            if bundles:
                ids = [b[0] for b in bundles]
                marks = ", ".join(["%s"] * len(ids))
                cursor.execute(
                    f"SELECT bundle_id, MAX(po_no), MAX(`order`) "
                    f"FROM machin_production_count WHERE bundle_id IN ({marks}) "
                    f"GROUP BY bundle_id",
                    ids,
                )
                po_map = {r[0]: (r[1] or "—", r[2] or "—") for r in cursor.fetchall()}

        if kind == "reject":
            rows = []
            for bid, style, part, q, p, rj, _d in bundles:
                if int(rj or 0) > 0:
                    po, order = po_map.get(bid, ("—", "—"))
                    rows.append(
                        {
                            "bundle_id": bid,
                            "style": style or "—",
                            "process": part or "—",
                            "po_no": po,
                            "order_no": order,
                            "qty": int(q or 0),
                            "pass_qty": int(p or 0),
                            "reject": int(rj or 0),
                        }
                    )
            rows.sort(key=lambda r: -r["reject"])
            return Response({"kind": kind, "date": str(on_date), "rows": rows})

        # kind == output (default): group by style / order / po
        groups: dict = {}
        for bid, style, _part, q, p, rj, d in bundles:
            po, order = po_map.get(bid, ("—", "—"))
            key = (style or "—", order, po)
            g = groups.setdefault(
                key,
                {"style": key[0], "order_no": order, "po_no": po,
                 "qty": 0, "pass_qty": 0, "defect": 0, "reject": 0, "bundles": 0},
            )
            g["qty"] += int(q or 0)
            g["pass_qty"] += int(p or 0)
            g["reject"] += int(rj or 0)
            g["defect"] += int(d or 0)
            g["bundles"] += 1
        rows = sorted(groups.values(), key=lambda g: -g["qty"])
        return Response({"kind": "output", "date": str(on_date), "rows": rows})


class TargetOutputReportView(APIView):
    """GET /api/automation/target_output_report/?from=&to=

    Date-wise target vs output report behind the Target / Output KPI cards:
    - summary: one row per date (target, output, achieve%, checked, defect, reject)
    - details: one row per date + style + order + po + color (day_qc_diffect)
    """

    def get(self, request):
        d_from = _parse_on_date(request.query_params.get("from"))
        d_to = _parse_on_date(request.query_params.get("to"))
        if d_to < d_from:
            d_from, d_to = d_to, d_from
        if (d_to - d_from).days > 62:
            return Response({"detail": "Date range too large (max 62 days)."}, status=400)

        line_ids = sorted({r["line_no"] for r in LineLayout.objects.values("line_no")})

        # date-wise floor target = latest target row per line per date, summed
        target_by_date: dict[str, int] = defaultdict(int)
        if line_ids:
            try:
                with connections["cuttingedge"].cursor() as cursor:
                    marks = ", ".join(["%s"] * len(line_ids))
                    cursor.execute(
                        f"SELECT hr_line_id, production_date, target_qty "
                        f"FROM pt_sewing_daily_line_targets "
                        f"WHERE hr_line_id IN ({marks}) "
                        f"AND production_date BETWEEN %s AND %s ORDER BY id",
                        [*line_ids, d_from, d_to],
                    )
                    latest: dict[tuple, int] = {}
                    for hr_id, pdate, tqty in cursor.fetchall():
                        latest[(int(hr_id), str(pdate))] = int(tqty or 0)
                    for (_hr, pdate), tq in latest.items():
                        target_by_date[pdate] += tq
            except Exception:
                pass

        # QC output per save, grouped date/style/order/po/color (pass repeats
        # on every row of one save → per-save first via bundle_id+created_at)
        groups: dict[tuple, dict] = {}
        date_sum: dict[str, dict] = {}
        bundle_seen: dict[tuple, int] = {}
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT date, COALESCE(style, '—'), COALESCE(mbm_order, '—'), "
                "COALESCE(po, '—'), COALESCE(color, '—'), bundle_id, "
                "MAX(bundle_qty), MAX(pass_qty), COALESCE(SUM(defect_qty), 0), "
                "MAX(reject_qty), COALESCE(MAX(diffect_to_pass), 0), "
                "COALESCE(MAX(reject_to_pass), 0), COALESCE(MAX(qc_check), 0) "
                "FROM day_qc_diffect WHERE date BETWEEN %s AND %s "
                "GROUP BY date, style, mbm_order, po, color, bundle_id, created_at",
                [d_from, d_to],
            )
            for dt, style, order, po, color, bid, q, pq, dq, rj, d2p, r2p, qc in cursor.fetchall():
                dkey = str(dt)
                gkey = (dkey, style, order, po, color)
                g = groups.setdefault(
                    gkey,
                    {"date": dkey, "style": style, "order_no": order, "po_no": po,
                     "color": color, "bundles": set(), "checked": 0, "output": 0,
                     "defect": 0, "reject": 0},
                )
                s = date_sum.setdefault(
                    dkey, {"checked": 0, "output": 0, "defect": 0, "reject": 0}
                )
                q, pq, dq = int(q or 0), int(pq or 0), int(dq or 0)
                rj, d2p, r2p = int(rj or 0), int(d2p or 0), int(r2p or 0)
                qc = int(qc or 0)
                if qc == 0:  # legacy rows: bundle qty once
                    bkey = (gkey, str(bid))
                    prev_q = bundle_seen.get(bkey, 0)
                    if q > prev_q:
                        qc = q - prev_q
                        bundle_seen[bkey] = q
                g["checked"] += qc
                s["checked"] += qc
                g["bundles"].add(str(bid))
                g["output"] += pq
                s["output"] += pq
                g["defect"] += dq  # defects found
                s["defect"] += dq
                g["reject"] += rj - r2p
                s["reject"] += rj - r2p

        details = [
            {**g, "bundles": len(g["bundles"]),
             "defect": max(0, g["defect"]), "reject": max(0, g["reject"])}
            for g in groups.values()
        ]
        details.sort(key=lambda r: (r["date"], r["style"], r["po_no"], r["color"]))

        summary = []
        for dkey in sorted(set(date_sum) | set(target_by_date)):
            s = date_sum.get(dkey, {"checked": 0, "output": 0, "defect": 0, "reject": 0})
            tq = int(target_by_date.get(dkey, 0))
            out = int(s["output"])
            summary.append(
                {"date": dkey, "target": tq, "output": out,
                 "ach_pct": round(out / tq * 100, 1) if tq else 0.0,
                 "checked": int(s["checked"]),
                 "defect": max(0, int(s["defect"])),
                 "reject": max(0, int(s["reject"]))}
            )
        tot = {
            "target": sum(r["target"] for r in summary),
            "output": sum(r["output"] for r in summary),
            "checked": sum(r["checked"] for r in summary),
            "defect": sum(r["defect"] for r in summary),
            "reject": sum(r["reject"] for r in summary),
        }
        tot["ach_pct"] = round(tot["output"] / tot["target"] * 100, 1) if tot["target"] else 0.0

        return Response(
            {"from": str(d_from), "to": str(d_to),
             "summary": summary, "totals": tot, "details": details}
        )
