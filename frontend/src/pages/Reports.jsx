import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Printer } from "lucide-react";
import toast from "react-hot-toast";

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
/** Small labelled value for mobile report cards. */
function MStat({ label, value, tone = "" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-[14px] font-bold tabular-nums ${tone || "text-slate-800"}`}>{value}</div>
    </div>
  );
}

const TABS = [
  { id: "efficiency", label: "Efficiency Report" },
  { id: "manhour", label: "Man Hour Details" },
  { id: "production", label: "Production Report" },
  { id: "hourlyprod", label: "Hourly Production" },
  { id: "quality", label: "Quality & DHU Report" },
];

/** Hourly production matrix (buyer/style/po × hour) from day_qc_diffect,
 *  with CRUD for manual hourly entries. */
function HourlyProduction({ token, date }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ hour: 8, line: "", buyer: "", style: "", po: "", qty: "" });
  const [editId, setEditId] = useState(null);
  const [editQty, setEditQty] = useState("");

  const q = useQuery({
    queryKey: ["hourly-production", date],
    queryFn: () =>
      api.get("/automation/hourly_production/", { params: { date } }).then((r) => r.data),
    enabled: !!token,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["hourly-production", date] });
  const onErr = (e) => toast.error(e?.response?.data?.detail || e.message || "Failed");

  const createM = useMutation({
    mutationFn: () => api.post("/automation/hourly_production/", { date, ...form, qty: Number(form.qty) }),
    onSuccess: () => {
      toast.success("Hourly production added");
      setForm((f) => ({ ...f, qty: "" }));
      invalidate();
    },
    onError: onErr,
  });
  const updateM = useMutation({
    mutationFn: ({ id, qty }) => api.put("/automation/hourly_production/", { id, qty }),
    onSuccess: () => {
      toast.success("Entry updated");
      setEditId(null);
      invalidate();
    },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: (id) => api.delete("/automation/hourly_production/", { params: { id } }),
    onSuccess: () => {
      toast.success("Entry deleted");
      invalidate();
    },
    onError: onErr,
  });

  const D = q.data;
  const hours = D?.hours ?? [];
  const S = D?.summary;
  const th2 = "border border-slate-200 px-2 py-2 text-center whitespace-nowrap";
  const td2 = "border border-slate-200 px-2 py-1.5 text-center tabular-nums";
  const hourLabel = (h) => `${String(h).padStart(2, "0")}–${String((h + 1) % 24).padStart(2, "0")}`;

  return (
    <div className="space-y-3">
      {/* manual entry form */}
      <form
        className="no-print flex flex-wrap items-end gap-2 rounded-2xl bg-white border border-slate-200 p-3 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.style.trim()) return toast.error("Style is required.");
          if (!Number(form.qty)) return toast.error("Qty is required.");
          createM.mutate();
        }}
      >
        <label className="text-xs text-slate-500">
          Hour
          <select value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => 8 + i).map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Line
          <select
            value={form.line}
            onChange={(e) => setForm({ ...form, line: e.target.value })}
            className="mt-1 block w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">Line…</option>
            {(D?.lines ?? []).map((l) => (
              <option key={l.line} value={l.line}>Line {l.label}</option>
            ))}
          </select>
        </label>
        {(() => {
          const combos = D?.options ?? [];
          // cascading: buyer filters styles, style filters POs; picking a
          // style or PO auto-selects the rest of its combo
          const buyers = [...new Set(combos.map((o) => o.buyer).filter(Boolean))];
          const styles = [
            ...new Set(
              combos
                .filter((o) => !form.buyer || o.buyer === form.buyer)
                .map((o) => o.style)
                .filter(Boolean),
            ),
          ];
          const pos = [
            ...new Set(
              combos
                .filter(
                  (o) =>
                    (!form.buyer || o.buyer === form.buyer) &&
                    (!form.style || o.style === form.style),
                )
                .map((o) => o.po)
                .filter(Boolean),
            ),
          ];
          const onBuyer = (v) =>
            setForm((prev) => {
              const next = { ...prev, buyer: v };
              // style/po of another buyer no longer valid
              if (prev.style && !combos.some((o) => o.buyer === v && o.style === prev.style)) {
                next.style = "";
                next.po = "";
              }
              return next;
            });
          const onStyle = (v) =>
            setForm((prev) => {
              const next = { ...prev, style: v };
              const match = combos.filter((o) => o.style === v);
              if (match.length) {
                next.buyer = match[0].buyer; // buyer auto-select
                const mpos = [...new Set(match.map((o) => o.po).filter(Boolean))];
                next.po = mpos.length === 1 ? mpos[0] : prev.po && mpos.includes(prev.po) ? prev.po : "";
              }
              return next;
            });
          const onPo = (v) =>
            setForm((prev) => {
              const next = { ...prev, po: v };
              const combo = combos.find((o) => o.po === v);
              if (combo) {
                next.buyer = combo.buyer; // buyer + style auto-select
                next.style = combo.style;
              }
              return next;
            });
          const field = (label, key, value, onChange, list, w) => (
            <label className="text-xs text-slate-500">
              {label}
              <input
                value={value}
                list={`hp-${key}-list`}
                onChange={(e) => onChange(e.target.value)}
                placeholder={`search ${label.toLowerCase()}…`}
                className={`mt-1 block ${w} rounded-lg border border-slate-200 px-2 py-2 text-sm`}
              />
              <datalist id={`hp-${key}-list`}>
                {list.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
          );
          return (
            <>
              {field("Buyer", "buyer", form.buyer, onBuyer, buyers, "w-32")}
              {field("Style", "style", form.style, onStyle, styles, "w-36")}
              {field("Po", "po", form.po, onPo, pos, "w-36")}
            </>
          );
        })()}
        <label className="text-xs text-slate-500">
          QC Pass Qty
          <input type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} className="mt-1 block w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm" />
        </label>
        <button type="submit" disabled={createM.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          + Add entry
        </button>
      </form>

      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-card">
        <div className="border-b-2 border-slate-800 px-4 py-3 text-center">
          <div className="text-lg font-bold tracking-tight text-slate-900">MBM Group</div>
          <div className="text-[13px] font-semibold text-slate-700">Hourly Production Report</div>
          <div className="mt-1 flex flex-wrap justify-center gap-x-4 text-[12px] text-slate-600">
            <span>Date: <b className="text-slate-900">{D?.date ?? date}</b></span>
            {S ? (
              <>
                <span>Checked <b>{S.checked}</b></span>
                <span className="text-emerald-700">Production <b>{S.production}</b></span>
                <span className="text-amber-700">Defect <b>{S.defect}</b></span>
                <span className="text-rose-700">Reject <b>{S.reject}</b></span>
              </>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="bg-slate-100 text-[10.5px] uppercase tracking-wide text-slate-600">
                <th className={th2}>Line</th>
                <th className={`${th2} text-left`}>Buyer</th>
                <th className={`${th2} text-left`}>Style</th>
                <th className={`${th2} text-left`}>PO</th>
                {hours.map((h) => (
                  <th key={h} className={th2}>{hourLabel(h)}</th>
                ))}
                <th className={`${th2} bg-slate-200`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(D?.rows ?? []).map((r, i) => (
                <tr key={i} className="hover:bg-sky-50/40">
                  <td className={`${td2} font-bold text-slate-900`}>{r.line_label ?? r.line}</td>
                  <td className={`${td2} text-left font-semibold text-slate-800`}>{r.buyer}</td>
                  <td className={`${td2} max-w-[180px] truncate text-left`} title={r.style}>{r.style}</td>
                  <td className={`${td2} text-left`}>{r.po}</td>
                  {hours.map((h) => {
                    const v = r.by_hour[String(h)] || 0;
                    return (
                      <td key={h} className={`${td2} ${v ? "bg-emerald-50 font-bold text-emerald-800" : "text-slate-300"}`}>
                        {v || "·"}
                      </td>
                    );
                  })}
                  <td className={`${td2} bg-slate-50 font-bold text-slate-900`}>{fmt(r.total)}</td>
                </tr>
              ))}
              {!(D?.rows ?? []).length ? (
                <tr>
                  <td colSpan={hours.length + 5} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    {q.isFetching ? "Loading…" : "No production recorded for this date."}
                  </td>
                </tr>
              ) : null}
            </tbody>
            {D?.rows?.length ? (
              <tfoot>
                <tr className="bg-slate-200 font-bold text-slate-900">
                  <td colSpan={4} className={`${td2} text-left`}>Hour Total</td>
                  {hours.map((h) => (
                    <td key={h} className={td2}>{D.hour_totals[String(h)] || "·"}</td>
                  ))}
                  <td className={td2}>{fmt(S?.production ?? 0)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
          Source: day_qc_diffect — production = QC pass qty per save, grouped buyer/style/po × hour.
        </div>
      </div>

      {/* manual entries CRUD list */}
      {(D?.manual ?? []).length ? (
        <div className="no-print rounded-2xl bg-white border border-slate-200 p-3 shadow-card">
          <div className="mb-2 text-sm font-semibold text-slate-800">Manual entries ({D.manual.length})</div>
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {D.manual.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12.5px]">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold tabular-nums text-slate-600">{hourLabel(m.hour)}</span>
                {m.line ? <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">Line {m.line_label || m.line}</span> : null}
                <span className="min-w-0 flex-1 truncate text-slate-700" title={`${m.buyer} ${m.style} ${m.po}`}>
                  {m.style}{m.po ? ` · ${m.po}` : ""}{m.buyer ? ` · ${m.buyer}` : ""}
                </span>
                {editId === m.id ? (
                  <>
                    <input type="number" min="1" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1 text-[12.5px]" autoFocus />
                    <button type="button" className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white" disabled={updateM.isPending}
                      onClick={() => { if (!Number(editQty)) return toast.error("Qty required"); updateM.mutate({ id: m.id, qty: Number(editQty) }); }}>
                      Save
                    </button>
                    <button type="button" className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500" onClick={() => setEditId(null)}>✕</button>
                  </>
                ) : (
                  <>
                    <b className="tabular-nums text-emerald-700">{m.qty} pcs</b>
                    <button type="button" title="Edit qty" className="rounded px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => { setEditId(m.id); setEditQty(String(m.qty)); }}>✎</button>
                    <button type="button" title="Delete" className="rounded px-1.5 py-0.5 text-[12px] text-rose-400 hover:bg-rose-50 hover:text-rose-600" disabled={deleteM.isPending}
                      onClick={() => { if (window.confirm(`Delete ${m.qty} pcs @ ${hourLabel(m.hour)}?`)) deleteM.mutate(m.id); }}>🗑</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Reports() {
  const token = useAuthStore((s) => s.accessToken);
  const [urlParams] = useSearchParams();
  const [tab, setTab] = useState(urlParams.get("tab") || "efficiency");
  const [from, setFrom] = useState(urlParams.get("date") || todayISO());
  const [to, setTo] = useState(urlParams.get("date") || todayISO());

  const report = useQuery({
    queryKey: ["day-efficiency", from, to],
    queryFn: () =>
      api
        .get("/reports/day_efficiency/", { params: { date_from: from, date_to: to } })
        .then((r) => r.data),
    enabled: !!token && (tab === "efficiency" || tab === "production"),
  });

  const [qLine, setQLine] = useState(null); // {floor, line}
  const quality = useQuery({
    queryKey: ["report-quality", from, qLine?.floor, qLine?.line],
    queryFn: () =>
      api
        .get("/reports/quality/", { params: { date: from, floor: qLine?.floor, line: qLine?.line } })
        .then((r) => r.data),
    enabled: !!token && tab === "quality",
  });

  const manhour = useQuery({
    queryKey: ["manhour-details", from],
    queryFn: () =>
      api.get("/automation/floor_overview_staff/", { params: { date: from } }).then((r) => r.data),
    enabled: !!token && tab === "manhour",
  });

  const rows = report.data?.rows ?? [];
  const T = report.data?.totals;

  const mhRows = Object.entries(manhour.data?.machine_hours ?? {})
    .map(([mid, v]) => ({ mid, ...v }))
    .sort((a, b) => Number(a.mid) - Number(b.mid));
  const mhT = manhour.data?.totals;

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
        <th>Present MP</th><th>Active W/S</th><th>Day Man Hour</th><th>Output (Pcs)</th><th>Day SAH</th><th>Efficiency %</th><th>Target Ach %</th>
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

  function exportManHourExcel() {
    const body = mhRows
      .map(
        (r) => `
      <tr>
        <td>M${r.mid}</td><td>${r.operators.join(", ")}</td><td>${r.in_time}</td><td>${r.sewing_start}</td>
        <td>${r.count_from}</td><td>${r.break_display}</td><td>${r.still_in ? "Running" : r.out_time}</td>
        <td>${r.working_display}</td><td>${r.actual_display}</td>
      </tr>`
      )
      .join("");
    const foot = mhT
      ? `<tr style="background:#e2e8f0;font-weight:bold">
          <td>Total</td><td>${mhT.staff} staff · ${mhT.machines} W/S</td><td></td><td></td><td></td>
          <td>${mhT.break_display}</td><td></td><td>${mhT.working_display}</td><td>${mhT.actual_display}</td>
        </tr>`
      : "";
    const html = `<html><head><meta charset="utf-8"></head><body>
      <h3>MBM Group — Line Man Hour Details (${from})</h3>
      <table border="1" cellspacing="0" cellpadding="4">
        <tr style="background:#334155;color:#fff;font-weight:bold">
          <th>Machine</th><th>Operator</th><th>In Time</th><th>Sewing Start</th><th>Count From</th>
          <th>Break</th><th>End Time</th><th>Working Hour</th><th>Man Hour</th>
        </tr>${body}${foot}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Man-hour-details-${from}.xls`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function exportProductionExcel() {
    const body = rows
      .map(
        (r) => `
      <tr>
        <td>${r.date}</td><td>${r.floor}</td><td>${r.line}</td><td>${r.styles}</td>
        <td>${r.plan_target}</td><td>${r.output}</td><td>${r.ach_pct}%</td>
      </tr>`
      )
      .join("");
    const foot = T
      ? `<tr style="background:#e2e8f0;font-weight:bold">
          <td colspan="4">Total</td><td>${T.plan_target}</td><td>${T.output}</td><td>${T.ach_pct}%</td>
        </tr>`
      : "";
    const html = `<html><head><meta charset="utf-8"></head><body>
      <h3>MBM Group — Production Report (${from} to ${to})</h3>
      <table border="1" cellspacing="0" cellpadding="4">
        <tr style="background:#334155;color:#fff;font-weight:bold">
          <th>Date</th><th>Floor</th><th>Line</th><th>Style</th><th>Target</th><th>Production</th><th>Achieve %</th>
        </tr>${body}${foot}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Production-report-${from}_${to}.xls`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const EXPORTS = { efficiency: exportExcel, manhour: exportManHourExcel, production: exportProductionExcel };

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
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-600 mt-1">
          Day efficiency &amp; line man hour — plan (ERP targets) vs actual (staff punches + QC output).
        </p>
      </header>

      <div className="no-print flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-sm border ${
              tab === t.id ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="no-print flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-600">{tab === "efficiency" || tab === "production" ? "From" : "Date"}</label>
        <input
          type="date"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        {tab === "efficiency" || tab === "production" ? (
          <>
            <label className="text-xs text-slate-600">To</label>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        ) : null}
        {tab === "quality" ? (
          <>
            <label className="text-xs text-slate-600">Line</label>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={qLine ? `${qLine.floor}-${qLine.line}` : ""}
              onChange={(e) => {
                const [f, l] = e.target.value.split("-").map(Number);
                setQLine({ floor: f, line: l });
              }}
            >
              {(quality.data?.lines ?? []).map((l) => (
                <option key={`${l.floor}-${l.line}`} value={`${l.floor}-${l.line}`}>
                  Line {l.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {EXPORTS[tab] ? (
          <button
            type="button"
            onClick={EXPORTS[tab]}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <FileSpreadsheet className="h-4 w-4" /> Export Excel
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" /> Print
        </button>
      </div>

      {tab === "production" ? (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-card">
          <div className="border-b-2 border-slate-800 px-4 py-3 text-center">
            <div className="text-lg font-bold tracking-tight text-slate-900">MBM Group</div>
            <div className="text-[13px] font-semibold text-slate-700">Production Report</div>
            <div className="mt-1 text-[12px] text-slate-600">
              Date: <b className="text-slate-900">{from === to ? from : `${from} — ${to}`}</b>
            </div>
          </div>
          {/* mobile: card per line/day */}
          <div className="space-y-2 p-3 md:hidden">
            {rows.map((r, i) => (
              <div key={`pm-${r.date}-${r.line}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{r.line}</span>
                  <span className="text-[12px] tabular-nums text-slate-500">{r.date}</span>
                </div>
                <div className="mt-0.5 truncate text-[12px] text-slate-500" title={r.styles}>{r.styles}</div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <MStat label="Target" value={fmt(r.plan_target)} />
                  <MStat label="Production" value={fmt(r.output)} />
                  <MStat label="Achieve %" value={`${r.ach_pct}%`} tone={r.ach_pct >= 100 ? "text-emerald-700" : r.ach_pct >= 80 ? "text-amber-700" : "text-rose-700"} />
                </div>
              </div>
            ))}
            {!rows.length ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                {report.isFetching ? "Loading…" : "No data for this date range."}
              </div>
            ) : null}
            {T ? (
              <div className="rounded-xl border-2 border-slate-300 bg-slate-100 p-3">
                <div className="mb-1.5 text-[11px] font-bold uppercase text-slate-500">Total</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <MStat label="Target" value={fmt(T.plan_target)} />
                  <MStat label="Production" value={fmt(T.output)} />
                  <MStat label="Achieve %" value={`${T.ach_pct}%`} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-[12px]">
              <thead>
                <tr className="bg-slate-100 text-[10.5px] uppercase tracking-wide text-slate-600">
                  <th className={th}>Date</th>
                  <th className={th}>Floor</th>
                  <th className={th}>Line</th>
                  <th className={`${th} text-left`}>Style</th>
                  <th className={th}>Target</th>
                  <th className={`${th} bg-emerald-50 text-emerald-700`}>Production</th>
                  <th className={`${th} bg-emerald-100 text-emerald-800`}>Achieve %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.date}-${r.line}-${i}`} className="hover:bg-sky-50/40">
                    <td className={`${td} whitespace-nowrap font-semibold text-slate-800`}>{r.date}</td>
                    <td className={td}>{r.floor}</td>
                    <td className={`${td} font-bold text-slate-900`}>{r.line}</td>
                    <td className={`${td} max-w-[280px] truncate text-left`} title={r.styles}>{r.styles}</td>
                    <td className={`${td} font-semibold`}>{fmt(r.plan_target)}</td>
                    <td className={`${td} bg-emerald-50/50 font-bold text-slate-900`}>{fmt(r.output)}</td>
                    <td className={`${td} font-bold ${r.ach_pct >= 100 ? "text-emerald-700" : r.ach_pct >= 80 ? "text-amber-700" : "text-rose-700"}`}>{r.ach_pct}%</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                      {report.isFetching ? "Loading…" : "No data for this date range."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {T ? (
                <tfoot>
                  <tr className="bg-slate-200 font-bold text-slate-900">
                    <td colSpan={4} className={`${td} text-left`}>Total</td>
                    <td className={td}>{fmt(T.plan_target)}</td>
                    <td className={td}>{fmt(T.output)}</td>
                    <td className={`${td} text-emerald-800`}>{T.ach_pct}%</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
            Target = ERP daily line target · Production = QC pass qty · Achieve % = Production ÷ Target
          </div>
        </div>
      ) : null}

      {tab === "quality" ? (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-card">
          {/* paper-style header */}
          <div className="border-b-2 border-slate-800 px-4 py-3 text-center">
            <div className="text-lg font-bold tracking-tight text-slate-900">MBM Group</div>
            <div className="text-[13px] font-semibold text-slate-700">
              Quality Control In Line / End Line 100% Inspection Report
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[12px] text-slate-600">
              <span>Line: <b className="text-slate-900">{quality.data?.line_label ?? "—"}</b></span>
              <span>Buyer: <b className="text-slate-900">{quality.data?.header?.buyer ?? "—"}</b></span>
              <span className="max-w-[380px] truncate">Style: <b className="text-slate-900">{quality.data?.header?.style ?? "—"}</b></span>
              <span>Date: <b className="text-slate-900">{quality.data?.date ?? "—"}</b></span>
              <span>DHU: <b className="text-amber-700">{quality.data?.totals?.defect_pct ?? 0}%</b></span>
            </div>
          </div>

          {/* mobile: totals + defect list (hourly matrix stays below, scrollable) */}
          <div className="space-y-2 p-3 md:hidden">
            <div className="grid grid-cols-5 gap-1.5">
              <MStat label="Check" value={quality.data?.totals?.checked ?? 0} />
              <MStat label="Pass" value={quality.data?.totals?.passed ?? 0} tone="text-emerald-700" />
              <MStat label="Defect" value={quality.data?.totals?.defect ?? 0} tone="text-amber-700" />
              <MStat label="Reject" value={quality.data?.totals?.reject ?? 0} tone="text-rose-700" />
              <MStat label="DHU %" value={`${quality.data?.totals?.defect_pct ?? 0}`} tone="text-amber-700" />
            </div>
            {(quality.data?.defect_rows ?? []).map((r, i) => (
              <div key={`qm-${i}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{r.defect_name}</span>
                  <span className="text-[11px] text-slate-400">
                    {r.defect_code || "—"}{r.machin_id ? ` · M${r.machin_id}` : ""}
                    {r.operator_name ? ` · ${r.operator_name}` : r.operator_id ? ` · ${r.operator_id}` : ""}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[13px] font-bold tabular-nums text-amber-800">{r.total}</span>
              </div>
            ))}
            {!(quality.data?.defect_rows ?? []).length ? (
              <div className="px-4 py-4 text-center text-sm text-slate-400">
                {quality.isFetching ? "Loading…" : "No defects recorded for this line/date."}
              </div>
            ) : null}
            <div className="text-center text-[11px] text-slate-400">Hour-wise matrix below — swipe sideways to scroll</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead>
                <tr className="bg-slate-100 text-[10.5px] uppercase tracking-wide text-slate-600">
                  <th className="border border-slate-200 px-2 py-2 text-left">Defect Name</th>
                  <th className="border border-slate-200 px-2 py-2">Code</th>
                  <th className="border border-slate-200 px-2 py-2">Operator</th>
                  <th className="border border-slate-200 px-2 py-2">M/C Code</th>
                  {(quality.data?.hours ?? []).map((h) => (
                    <th key={h} className="border border-slate-200 px-1.5 py-2 text-center">
                      {String(h).padStart(2, "0")}–{String((h + 1) % 24).padStart(2, "0")}
                    </th>
                  ))}
                  <th className="border border-slate-200 px-2 py-2 text-center bg-slate-200">TTL</th>
                </tr>
              </thead>
              <tbody>
                {(quality.data?.defect_rows ?? []).map((r, i) => (
                  <tr key={i} className="hover:bg-amber-50/40">
                    <td className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-800">{r.defect_name}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{r.defect_code || "—"}</span>
                    </td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                      {r.operator_name ? (
                        <>
                          <span className="block text-[12px] font-semibold text-slate-800">{r.operator_name}</span>
                          <span className="text-[10px] tabular-nums text-slate-400">ID {r.operator_id}</span>
                        </>
                      ) : (
                        <span className="tabular-nums text-slate-500">{r.operator_id || "—"}</span>
                      )}
                    </td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                      {r.machin_id ? <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">M{r.machin_id}{r.machin_code ? ` · ${r.machin_code}` : ""}</span> : "—"}
                    </td>
                    {(quality.data?.hours ?? []).map((h) => {
                      const v = r.by_hour?.[String(h)] || 0;
                      return (
                        <td key={h} className={`border border-slate-200 px-1.5 py-1.5 text-center tabular-nums ${v ? "bg-amber-50 font-bold text-amber-700" : "text-slate-300"}`}>
                          {v || "·"}
                        </td>
                      );
                    })}
                    <td className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-bold tabular-nums text-slate-900">{r.total}</td>
                  </tr>
                ))}
                {!(quality.data?.defect_rows ?? []).length ? (
                  <tr>
                    <td colSpan={(quality.data?.hours?.length ?? 10) + 5} className="border border-slate-200 px-3 py-5 text-center text-slate-400">
                      {quality.isFetching ? "Loading…" : "No defects recorded for this line/date."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot className="text-[12px]">
                {(() => {
                  const hrs = quality.data?.hours ?? [];
                  const S = quality.data?.summary ?? {};
                  const QT = quality.data?.totals ?? { checked: 0, passed: 0, defect: 0, defect_pct: 0 };
                  let cumC = 0, cumP = 0, cumD = 0;
                  const frows = [
                    { label: "Total Checked / Cum", cls: "text-slate-800", get: (h) => { const v = S[String(h)]?.checked || 0; cumC += v; return v ? `${v}/${cumC}` : "·"; }, total: QT.checked },
                    { label: "Total Passed / Cum", cls: "text-emerald-700", get: (h) => { const v = S[String(h)]?.passed || 0; cumP += v; return v ? `${v}/${cumP}` : "·"; }, total: QT.passed },
                    { label: "Total Defect / Cum", cls: "text-rose-700", get: (h) => { const v = S[String(h)]?.defect || 0; cumD += v; return v ? `${v}/${cumD}` : "·"; }, total: QT.defect },
                    { label: "Repaired → Pass", cls: "text-sky-700", get: (h) => { const v = S[String(h)]?.repaired || 0; return v ? `${v}` : "·"; }, total: QT.repaired ?? 0 },
                    { label: "Total Reject", cls: "text-rose-700", get: (h) => { const v = S[String(h)]?.reject || 0; return v ? `${v}` : "·"; }, total: QT.reject ?? 0 },
                    { label: "Hourly DHU %", cls: "text-amber-700", get: (h) => { const c = S[String(h)]?.checked || 0; const dv = S[String(h)]?.defect || 0; return c ? `${((dv * 100) / c).toFixed(1)}%` : "·"; }, total: `${QT.defect_pct}%` },
                  ];
                  return frows.map((row) => (
                    <tr key={row.label} className="bg-slate-50 font-semibold">
                      <td colSpan={4} className={`border border-slate-200 px-2 py-1.5 ${row.cls}`}>{row.label}</td>
                      {hrs.map((h) => (
                        <td key={h} className={`border border-slate-200 px-1 py-1.5 text-center tabular-nums text-[11px] ${row.cls}`}>{row.get(h)}</td>
                      ))}
                      <td className={`border border-slate-200 bg-slate-200 px-2 py-1.5 text-center font-bold tabular-nums ${row.cls}`}>{row.total}</td>
                    </tr>
                  ));
                })()}
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap justify-between gap-3 border-t-2 border-slate-800 px-4 py-2.5 text-[12px] font-semibold text-slate-700">
            <span>TTL Checked: <b className="text-slate-900">{quality.data?.totals?.checked ?? 0}</b></span>
            <span>TTL Passed: <b className="text-emerald-700">{quality.data?.totals?.passed ?? 0}</b></span>
            <span>TTL Defect: <b className="text-rose-700">{quality.data?.totals?.defect ?? 0}</b></span>
            <span>TTL Reject: <b className="text-rose-700">{quality.data?.totals?.reject ?? 0}</b></span>
            <span>DHU %: <b className="text-amber-700">{quality.data?.totals?.defect_pct ?? 0}%</b></span>
          </div>
        </div>
      ) : null}

      {tab === "hourlyprod" ? <HourlyProduction token={token} date={from} /> : null}

      {tab === "manhour" ? (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-card">
          <div className="border-b-2 border-slate-800 px-4 py-3 text-center">
            <div className="text-lg font-bold tracking-tight text-slate-900">MBM Group</div>
            <div className="text-[13px] font-semibold text-slate-700">Line Man Hour Details — Machine Wise</div>
            <div className="mt-1 text-[12px] text-slate-600">
              Date: <b className="text-slate-900">{from}</b>
              {mhT ? (
                <span className="ml-3">
                  Staff <b>{mhT.staff}</b> · Active W/S <b>{mhT.machines}</b> · Working <b>{mhT.working_display}</b> · Break <b>{mhT.break_display}</b> · Man Hour <b className="text-emerald-700">{mhT.actual_display}</b>
                </span>
              ) : null}
            </div>
          </div>

          {/* mobile: card per machine */}
          <div className="space-y-2 p-3 md:hidden">
            {mhRows.map((r) => (
              <div key={`m-${r.mid}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900">M{r.mid}</span>
                    <span className="ml-2 truncate text-[12px] text-slate-500">{r.operators.join(", ") || "—"}</span>
                  </div>
                  {r.still_in ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Running</span>
                  ) : (
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-600">{r.out_time}</span>
                  )}
                </div>
                <div className="mt-1 text-[12px] tabular-nums text-slate-500">
                  In {r.in_time} · Sewing {r.sewing_start} · Break {r.break_display}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <MStat label="Working Hour" value={r.working_display} />
                  <MStat label="Man Hour" value={r.actual_display} tone="text-emerald-700" />
                </div>
              </div>
            ))}
            {!mhRows.length ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                {manhour.isFetching ? "Loading…" : "No punches for this date."}
              </div>
            ) : null}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-[12px]">
              <thead>
                <tr className="bg-slate-100 text-[10.5px] uppercase tracking-wide text-slate-600">
                  <th className={th}>Machine</th>
                  <th className={`${th} text-left`}>Operator</th>
                  <th className={th}>In Time</th>
                  <th className={th}>Sewing Start</th>
                  <th className={th} title="Man hour counting starts from 08:00 or the later punch">Count From</th>
                  <th className={th}>Break</th>
                  <th className={th}>End Time</th>
                  <th className={th}>Working Hour</th>
                  <th className={`${th} bg-emerald-50 text-emerald-700`}>Man Hour</th>
                </tr>
              </thead>
              <tbody>
                {mhRows.map((r) => (
                  <tr key={r.mid} className="hover:bg-sky-50/40">
                    <td className={`${td} font-bold text-slate-900`}>M{r.mid}</td>
                    <td className={`${td} max-w-[220px] truncate text-left`} title={r.operators.join(", ")}>{r.operators.join(", ") || "—"}</td>
                    <td className={td}>{r.in_time}</td>
                    <td className={td}>{r.sewing_start}</td>
                    <td className={`${td} text-slate-500`}>{r.count_from}</td>
                    <td className={td}>{r.break_display}</td>
                    <td className={td}>
                      {r.still_in ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Running</span> : r.out_time}
                    </td>
                    <td className={`${td} font-semibold`}>{r.working_display}</td>
                    <td className={`${td} bg-emerald-50/50 font-bold text-emerald-800`}>{r.actual_display}</td>
                  </tr>
                ))}
                {!mhRows.length ? (
                  <tr>
                    <td colSpan={9} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                      {manhour.isFetching ? "Loading…" : "No punches for this date."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {mhT ? (
                <tfoot>
                  <tr className="bg-slate-200 font-bold text-slate-900">
                    <td className={td}>Total</td>
                    <td className={`${td} text-left`}>{mhT.staff} staff · {mhT.machines} W/S</td>
                    <td className={td} colSpan={3} />
                    <td className={td}>{mhT.break_display}</td>
                    <td className={td} />
                    <td className={td}>{mhT.working_display}</td>
                    <td className={`${td} text-emerald-800`}>{mhT.actual_display}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
            In Time = first punch on the machine · Sewing Start = first production scan · Count From = 08:00 or the later
            punch · Working Hour = Count From → End (now while running) · Man Hour = Working − 1h break
          </div>
        </div>
      ) : null}

      {tab !== "efficiency" ? null : (
      <>
      {/* mobile: card per line/day */}
      <div className="space-y-2.5 md:hidden">
        {rows.map((r, i) => (
          <div key={`m-${r.date}-${r.line}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900">{r.line}</span>
              <span className="text-[12px] tabular-nums text-slate-500">{r.date}</span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-slate-500" title={r.styles}>
              {r.styles} · SMV {r.smv || "—"}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <MStat label="Target" value={fmt(r.plan_target)} />
              <MStat label="Production" value={fmt(r.output)} />
              <MStat label="Ach %" value={`${r.ach_pct}%`} tone={r.ach_pct >= 100 ? "text-emerald-700" : r.ach_pct >= 80 ? "text-amber-700" : "text-rose-700"} />
              <MStat label="Present MP" value={r.present_mp} />
              <MStat label="Man Hour" value={fmt(r.day_man_hour)} />
              <MStat label="Eff %" value={`${r.eff_pct}%`} tone={r.eff_pct >= 60 ? "text-emerald-700" : r.eff_pct >= 40 ? "text-amber-700" : "text-rose-700"} />
            </div>
          </div>
        ))}
        {!rows.length ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            {report.isFetching ? "Loading…" : "No data for this date range."}
          </div>
        ) : null}
        {T ? (
          <div className="rounded-xl border-2 border-slate-300 bg-slate-100 p-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase text-slate-500">Total</div>
            <div className="grid grid-cols-3 gap-1.5">
              <MStat label="Target" value={fmt(T.plan_target)} />
              <MStat label="Production" value={fmt(T.output)} />
              <MStat label="Ach %" value={`${T.ach_pct}%`} />
              <MStat label="Present MP" value={T.present_mp} />
              <MStat label="Man Hour" value={fmt(T.day_man_hour)} />
              <MStat label="Eff %" value={`${T.eff_pct}%`} tone="text-emerald-700" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-card md:block">
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
                <th className={`${th} bg-emerald-50 text-emerald-700`}>Active W/S</th>
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
          Present MP = distinct SEWING staff punched · Man Hour = Σ active workstations&apos; working hours
          (first in → last out per workstation, 1h break deducted) · Output = QC pass qty ·
          Day SAH = Σ output × SMV ÷ 60 · Efficiency % = Day SAH ÷ Day Man Hour
        </div>
      </div>
      </>
      )}
    </div>
  );
}
