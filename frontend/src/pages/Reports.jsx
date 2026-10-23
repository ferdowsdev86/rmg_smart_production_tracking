import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Printer } from "lucide-react";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n ?? "—");
const pct = (n) => `${(n ?? 0).toFixed ? n.toFixed(2) : n}%`;

/* Day Efficiency Report — modelled on the ERP sheet, from our own data:
   plan (ERP targets) vs actual (staff punches + QC output), SAH-based. */
export default function Reports() {
  const token = useAuthStore((s) => s.accessToken);
  const [urlParams] = useSearchParams();
  const [from, setFrom] = useState(urlParams.get("date") || todayISO());
  const [to, setTo] = useState(urlParams.get("date") || todayISO());

  const report = useQuery({
    queryKey: ["day-efficiency", from, to],
    queryFn: () =>
      api
        .get("/reports/day_efficiency/", { params: { date_from: from, date_to: to } })
        .then((r) => r.data),
    enabled: !!token,
  });

  const rows = report.data?.rows ?? [];
  const T = report.data?.totals;

  function exportExcel() {
    const head = `
      <tr style="background:#1e293b;color:#fff;font-weight:bold">
        <th colspan="5">Order Details</th><th>SMV</th>
        <th colspan="9">Plan</th>
        <th colspan="7">Actual (Productivity &amp; Efficiency)</th>
      </tr>
      <tr style="background:#334155;color:#fff">
        <th>Date</th><th>Floor</th><th>Line</th><th>Style</th><th>&nbsp;</th><th>Sewing SMV</th>
        <th>Plan MP</th><th>MO</th><th>HP</th><th>IM</th><th>Total MP</th><th>Plan Target</th><th>Plan WH</th><th>Plan Man Hour</th><th>Plan SAH</th>
        <th>Present MP</th><th>Active M/C</th><th>Day Man Hour</th><th>Output (Pcs)</th><th>Day SAH</th><th>Efficiency %</th><th>Target Ach %</th>
      </tr>`;
    const body = rows
      .map(
        (r) => `
      <tr>
        <td>${r.date}</td><td>${r.floor}</td><td>${r.line}</td><td>${r.styles}</td><td></td><td>${r.smv}</td>
        <td>${r.plan_mp}</td><td>${r.plan_mo}</td><td>${r.plan_hp}</td><td>${r.plan_im}</td><td>${r.plan_total_mp}</td>
        <td>${r.plan_target}</td><td>${r.plan_wh}</td><td>${r.plan_man_hour}</td><td>${r.plan_sah}</td>
        <td>${r.present_mp}</td><td>${r.active_machines}</td><td>${r.day_man_hour}</td><td>${r.output}</td><td>${r.day_sah}</td>
        <td>${r.eff_pct}%</td><td>${r.ach_pct}%</td>
      </tr>`
      )
      .join("");
    const foot = T
      ? `<tr style="background:#e2e8f0;font-weight:bold">
          <td colspan="5">Total</td><td></td>
          <td>${T.plan_mp}</td><td></td><td></td><td></td><td>${T.plan_total_mp}</td>
          <td>${T.plan_target}</td><td></td><td>${T.plan_man_hour}</td><td>${T.plan_sah}</td>
          <td>${T.present_mp}</td><td>${T.active_machines}</td><td>${T.day_man_hour}</td><td>${T.output}</td><td>${T.day_sah}</td>
          <td>${T.eff_pct}%</td><td>${T.ach_pct}%</td>
        </tr>`
      : "";
    const html = `<html><head><meta charset="utf-8"></head><body>
      <h3>MBM Group — Day Efficiency Report (${from} to ${to})</h3>
      <table border="1" cellspacing="0" cellpadding="4">${head}${body}${foot}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Day-efficiency-report-${from}_${to}.xls`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const th = "border border-slate-200 px-2 py-2 text-center whitespace-nowrap";
  const td = "border border-slate-200 px-2 py-1.5 text-center tabular-nums";

  return (
    <div className="space-y-4">
      <style>{`@media print {
        @page { size: A4 landscape; margin: 8mm; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        aside, nav, .no-print { display: none !important; }
      }`}</style>

      <header className="no-print">
        <h1 className="text-2xl font-semibold text-slate-900">Efficiency Report</h1>
        <p className="text-sm text-slate-600 mt-1">
          Day efficiency — plan (ERP targets) vs actual (staff punches + QC output), SAH based.
        </p>
      </header>

      <div className="no-print flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-600">From</label>
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label className="text-xs text-slate-600">To</label>
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          type="button"
          onClick={exportExcel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          <FileSpreadsheet className="h-4 w-4" /> Export Excel
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" /> Print
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-card">
        {/* paper-style header */}
        <div className="border-b-2 border-slate-800 px-4 py-3 text-center">
          <div className="text-lg font-bold tracking-tight text-slate-900">MBM Group</div>
          <div className="text-[13px] font-semibold text-slate-700">Day Efficiency Report</div>
          <div className="mt-1 text-[12px] text-slate-600">
            Date: <b className="text-slate-900">{from === to ? from : `${from} — ${to}`}</b>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="bg-slate-800 text-[10.5px] uppercase tracking-wide text-white">
                <th colSpan={4} className={`${th} border-slate-600`}>Order Details</th>
                <th className={`${th} border-slate-600`}>SMV</th>
                <th colSpan={9} className={`${th} border-slate-600 bg-slate-700`}>Plan</th>
                <th colSpan={7} className={`${th} border-slate-600`}>Actual — Productivity &amp; Efficiency</th>
              </tr>
              <tr className="bg-slate-100 text-[10.5px] uppercase tracking-wide text-slate-600">
                <th className={th}>Date</th>
                <th className={th}>Floor</th>
                <th className={th}>Line</th>
                <th className={`${th} text-left`}>Style</th>
                <th className={th}>Sewing SMV</th>
                <th className={th}>MP</th>
                <th className={th}>MO</th>
                <th className={th}>HP</th>
                <th className={th}>IM</th>
                <th className={`${th} bg-slate-200`}>Total MP</th>
                <th className={th}>Target</th>
                <th className={th}>WH</th>
                <th className={th}>Man Hour</th>
                <th className={th}>SAH</th>
                <th className={`${th} bg-emerald-50 text-emerald-700`}>Present MP</th>
                <th className={`${th} bg-emerald-50 text-emerald-700`}>Active M/C</th>
                <th className={`${th} bg-emerald-50 text-emerald-700`}>Man Hour</th>
                <th className={`${th} bg-emerald-50 text-emerald-700`}>Output</th>
                <th className={`${th} bg-emerald-50 text-emerald-700`}>Day SAH</th>
                <th className={`${th} bg-emerald-100 text-emerald-800`}>Efficiency %</th>
                <th className={`${th} bg-emerald-100 text-emerald-800`}>Ach %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.date}-${r.line}-${i}`} className="hover:bg-sky-50/40">
                  <td className={`${td} whitespace-nowrap font-semibold text-slate-800`}>{r.date}</td>
                  <td className={td}>{r.floor}</td>
                  <td className={`${td} font-bold text-slate-900`}>{r.line}</td>
                  <td className={`${td} max-w-[220px] truncate text-left`} title={r.styles}>{r.styles}</td>
                  <td className={`${td} font-semibold`}>{r.smv || "—"}</td>
                  <td className={td}>{r.plan_mp}</td>
                  <td className={td}>{r.plan_mo}</td>
                  <td className={td}>{r.plan_hp}</td>
                  <td className={td}>{r.plan_im}</td>
                  <td className={`${td} bg-slate-50 font-semibold`}>{r.plan_total_mp}</td>
                  <td className={`${td} font-semibold`}>{fmt(r.plan_target)}</td>
                  <td className={td}>{r.plan_wh}</td>
                  <td className={td}>{fmt(r.plan_man_hour)}</td>
                  <td className={td}>{fmt(r.plan_sah)}</td>
                  <td className={`${td} bg-emerald-50/50 font-semibold`}>{r.present_mp}</td>
                  <td className={`${td} bg-emerald-50/50 font-semibold`}>{r.active_machines}</td>
                  <td className={`${td} bg-emerald-50/50`}>{fmt(r.day_man_hour)}</td>
                  <td className={`${td} bg-emerald-50/50 font-bold text-slate-900`}>{fmt(r.output)}</td>
                  <td className={`${td} bg-emerald-50/50`}>{fmt(r.day_sah)}</td>
                  <td className={`${td} font-bold ${r.eff_pct >= 60 ? "text-emerald-700" : r.eff_pct >= 40 ? "text-amber-700" : "text-rose-700"}`}>{pct(r.eff_pct)}</td>
                  <td className={`${td} font-bold ${r.ach_pct >= 100 ? "text-emerald-700" : r.ach_pct >= 80 ? "text-amber-700" : "text-rose-700"}`}>{r.ach_pct}%</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={21} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    {report.isFetching ? "Loading…" : "No data for this date range."}
                  </td>
                </tr>
              ) : null}
            </tbody>
            {T ? (
              <tfoot>
                <tr className="bg-slate-200 font-bold text-slate-900">
                  <td colSpan={4} className={`${td} text-left`}>Total</td>
                  <td className={td} />
                  <td className={td}>{T.plan_mp}</td>
                  <td className={td} colSpan={3} />
                  <td className={td}>{T.plan_total_mp}</td>
                  <td className={td}>{fmt(T.plan_target)}</td>
                  <td className={td} />
                  <td className={td}>{fmt(T.plan_man_hour)}</td>
                  <td className={td}>{fmt(T.plan_sah)}</td>
                  <td className={td}>{T.present_mp}</td>
                  <td className={td}>{T.active_machines}</td>
                  <td className={td}>{fmt(T.day_man_hour)}</td>
                  <td className={td}>{fmt(T.output)}</td>
                  <td className={td}>{fmt(T.day_sah)}</td>
                  <td className={`${td} text-emerald-800`}>{pct(T.eff_pct)}</td>
                  <td className={`${td} text-emerald-800`}>{T.ach_pct}%</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
          Present MP = distinct SEWING staff punched · Man Hour = Σ active machines&apos; working hours
          (first in → last out per machine, 1h break deducted) · Output = QC pass qty ·
          Day SAH = Σ output × SMV ÷ 60 · Efficiency % = Day SAH ÷ Day Man Hour
        </div>
      </div>
    </div>
  );
}
