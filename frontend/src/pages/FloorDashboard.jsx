import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Cpu,
  Factory,
  ShieldCheck,
  Target,
  TimerOff,
  Users,
  XCircle,
} from "lucide-react";

import { CardSkeleton } from "../components/LoadingSkeleton";
import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import { useSewingBoardSocket } from "../hooks/useSewingBoardSocket";

/* validated palette (dataviz checks passed on light surface) */
const C = { blue: "#2a78d6", orange: "#eb6834", green: "#1baf7a", amber: "#eda100", violet: "#7c5cd6" };
const STATUS = { good: "#0ca30c", warn: "#eda100", ser: "#eb6834", crit: "#d03b3b" };

const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const todayISO = () => new Date().toISOString().slice(0, 10);

function achTone(p) {
  if (p >= 100) return { text: "text-emerald-700", bar: "bg-emerald-500", dot: "🟢", hex: STATUS.good };
  if (p >= 90) return { text: "text-amber-600", bar: "bg-amber-400", dot: "🟡", hex: STATUS.warn };
  if (p >= 75) return { text: "text-orange-600", bar: "bg-orange-400", dot: "🟠", hex: STATUS.ser };
  return { text: "text-rose-600", bar: "bg-rose-500", dot: "🔴", hex: STATUS.crit };
}
const dhuTone = (v) => (v <= 3 ? "text-emerald-600" : v <= 5 ? "text-amber-600" : "text-rose-600");

/* Raised-card shadow shared by KPI cards (3D depth: drop + top highlight + bottom inset) */
const KPI_SHADOW = {
  boxShadow:
    "0 14px 24px -10px rgba(2,6,23,0.45), 0 3px 6px rgba(2,6,23,0.18), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.18)",
};

/* ---------- compact colorful KPI ---------- */
function Kpi({ label, value, suffix, sub, icon: Icon, grad, spark, onClick }) {
  return (
    <div onClick={onClick} style={KPI_SHADOW} className={`relative overflow-hidden rounded-2xl px-3 py-2.5 text-white ring-1 ring-white/20 transition-all duration-300 hover:-translate-y-0.5 ${grad} ${onClick ? "cursor-pointer hover:brightness-110 active:scale-[0.98]" : ""}`}>
      <div className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-white/10" />
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-extrabold uppercase tracking-wider text-white/75">{label}</span>
        <Icon className="h-3.5 w-3.5 opacity-80" />
      </div>
      <div className="mt-0.5 text-[21px] font-bold leading-none tracking-tight drop-shadow-sm">
        {value}
        {suffix ? <span className="ml-0.5 text-[11px] font-semibold text-white/80">{suffix}</span> : null}
      </div>
      {sub ? <div className="mt-0.5 text-[10px] font-semibold text-white/80">{sub}</div> : null}
      {spark != null ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white/95" style={{ width: `${Math.min(100, spark)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/* Soft colored surfaces per panel — colorful but standard, readable on light UI */
const PANEL_TINTS = {
  sky: "bg-gradient-to-br from-white via-sky-50/70 to-sky-100/60 ring-sky-200/80",
  violet: "bg-gradient-to-br from-white via-violet-50/70 to-fuchsia-100/50 ring-violet-200/80",
  emerald: "bg-gradient-to-br from-white via-emerald-50/70 to-lime-100/50 ring-emerald-200/80",
  purple: "bg-gradient-to-br from-white via-purple-50/70 to-violet-100/50 ring-purple-200/80",
  indigo: "bg-gradient-to-br from-white via-indigo-50/70 to-blue-100/50 ring-indigo-200/80",
};

function Panel({ stripe, icon: Icon, title, right, children, className = "", tint }) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl ring-1 transition-all duration-300 hover:-translate-y-0.5 ${PANEL_TINTS[tint] || "bg-white ring-slate-100"} ${className}`}
      style={{
        boxShadow:
          "0 14px 28px -10px rgba(15,23,42,0.20), 0 4px 10px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      <div className={`h-1.5 ${stripe}`} />
      <div className="flex flex-1 flex-col p-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-800">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white shadow-md ${stripe}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            {title}
          </div>
          {right}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

const AXIS = {
  axisLine: { lineStyle: { color: "#c9cdd6" } },
  axisLabel: { color: "#8a90a0", fontSize: 10 },
  splitLine: { lineStyle: { color: "#eef0f4" } },
};

/* The dashboard renders at a fixed design width and auto-scales to fit the
   viewer's screen (phone / tablet / laptop / TV) so the WHOLE view is always
   visible without scrolling. */
const DESIGN_W = 1560;

export default function FloorDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const [date, setDate] = useState(todayISO());
  const [clock, setClock] = useState("");
  const shellRef = useRef(null);
  const contentRef = useRef(null);
  const headerRef = useRef(null);
  const kpiRef = useRef(null);
  const alertsRef = useRef(null);
  const matrixRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, height: null, chartRowH: 210, bottomRowH: 220 });

  useSewingBoardSocket(!!token && date === todayISO());

  useEffect(() => {
    function refit() {
      const shell = shellRef.current;
      const content = contentRef.current;
      if (!shell || !content) return;
      const rect = shell.getBoundingClientRect();
      const availW = rect.width || DESIGN_W;
      const availH = Math.max(300, window.innerHeight - rect.top);
      // Width-fit scale; the design canvas height stretches so the scaled
      // board fills the screen exactly — edge to edge, no gap, no scroll.
      const scale = Math.min(availW / DESIGN_W, 2);
      const designH = Math.max(620, Math.floor(availH / scale));
      // Deterministic layout: measure the fixed blocks, then split the
      // remaining height between the two chart rows so every panel gets an
      // exact size for this screen ratio — no overflow, no overlap.
      const pad = 16;
      const gap = 8;
      const headH = headerRef.current?.offsetHeight || 50;
      const kpiH = kpiRef.current?.offsetHeight || 88;
      const alH = alertsRef.current?.offsetHeight || 32;
      const mxH = matrixRef.current?.offsetHeight || 250;
      const remaining = designH - pad - gap * 4 - headH - kpiH - alH - mxH;
      const chartRowH = Math.max(185, Math.round(remaining * 0.48));
      const bottomRowH = Math.max(185, remaining - chartRowH);
      setFit((prev) =>
        Math.abs(prev.scale - scale) > 0.005 ||
        prev.height !== availH ||
        prev.designH !== designH ||
        prev.chartRowH !== chartRowH ||
        prev.bottomRowH !== bottomRowH
          ? { scale, height: availH, designH, chartRowH, bottomRowH }
          : prev,
      );
    }
    refit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(refit) : null;
    if (ro && contentRef.current) ro.observe(contentRef.current);
    if (ro && shellRef.current) ro.observe(shellRef.current);
    window.addEventListener("resize", refit);
    const t = setInterval(refit, 1500); // charts mount async
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", refit);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setClock(
        d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
          " · " +
          d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const [drill, setDrill] = useState(null); // {kind, title}
  const [repRange, setRepRange] = useState({ from: todayISO(), to: todayISO() });
  const [qr, setQr] = useState({ date: todayISO(), line: null }); // quality report modal

  const { data: D, isLoading, isError } = useQuery({
    queryKey: ["floor-overview", date],
    queryFn: () => api.get("/automation/floor_overview/", { params: { date } }).then((r) => r.data),
    enabled: !!token,
    refetchInterval: date === todayISO() ? 3000 : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
  });

  const drillQ = useQuery({
    queryKey: ["floor-drill", drill?.kind, date],
    queryFn: () =>
      api
        .get("/automation/floor_overview_detail/", { params: { kind: drill.kind, date } })
        .then((r) => r.data),
    enabled: !!token && !!drill && ["output", "defect", "reject"].includes(drill.kind),
  });

  // Quality inspection report (modal behind the Defect vs Pass Rate card)
  const qualityRepQ = useQuery({
    queryKey: ["quality-report-modal", qr.date, qr.line?.floor, qr.line?.line],
    queryFn: () =>
      api
        .get("/reports/quality/", { params: { date: qr.date, floor: qr.line?.floor, line: qr.line?.line } })
        .then((r) => r.data),
    enabled: !!token && drill?.kind === "quality_report",
  });

  function qualityReportHtml(QR) {
    const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
    const hrs = QR.hours ?? [];
    const hlabel = (h) => `${String(h).padStart(2, "0")}–${String((h + 1) % 24).padStart(2, "0")}`;
    const defectRows = (QR.defect_rows ?? [])
      .map(
        (r) =>
          `<tr><td>${esc(r.defect_name)}</td><td class="c">${esc(r.defect_code || "—")}</td><td class="c">${esc(r.operator_id || "—")}</td><td class="c">${r.machin_id ? `M${r.machin_id}${r.machin_code ? " · " + esc(r.machin_code) : ""}` : "—"}</td>` +
          hrs.map((h) => `<td class="c">${r.by_hour?.[String(h)] || "·"}</td>`).join("") +
          `<td class="c b">${r.total}</td></tr>`,
      )
      .join("");
    const S = QR.summary ?? {};
    const T = QR.totals ?? { checked: 0, passed: 0, defect: 0, reject: 0, defect_pct: 0 };
    let cumC = 0, cumP = 0, cumD = 0;
    const sumDefs = [
      { label: "Total Checked / Cum", get: (h) => { const v = S[String(h)]?.checked || 0; cumC += v; return v ? `${v}/${cumC}` : "·"; }, total: T.checked },
      { label: "Total Passed / Cum", get: (h) => { const v = S[String(h)]?.passed || 0; cumP += v; return v ? `${v}/${cumP}` : "·"; }, total: T.passed },
      { label: "Total Defect / Cum", get: (h) => { const v = S[String(h)]?.defect || 0; cumD += v; return v ? `${v}/${cumD}` : "·"; }, total: T.defect },
      { label: "Repaired → Pass", cls: "text-sky-700", get: (h) => { const v = S[String(h)]?.repaired || 0; return v ? `${v}` : "·"; }, total: T.repaired ?? 0 },
      { label: "Total Reject", cls: "text-rose-700", get: (h) => { const v = S[String(h)]?.reject || 0; return v ? `${v}` : "·"; }, total: T.reject ?? 0 },
      { label: "Hourly Defect %", get: (h) => { const c = S[String(h)]?.checked || 0; const dv = S[String(h)]?.defect || 0; return c ? `${((dv * 100) / c).toFixed(1)}%` : "·"; }, total: `${T.defect_pct}%` },
    ];
    const sumRows = sumDefs
      .map(
        (row) =>
          `<tr class="sum"><td colspan="4">${row.label}</td>` +
          hrs.map((h) => `<td class="c">${row.get(h)}</td>`).join("") +
          `<td class="c b">${row.total}</td></tr>`,
      )
      .join("");
    return `<html><head><meta charset="utf-8"><title>Quality Inspection Report ${QR.date}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;padding:20px;color:#111}h1{font-size:18px;margin:0;text-align:center}h2{font-size:13px;margin:2px 0 8px;text-align:center;font-weight:600}
.meta{text-align:center;font-size:12px;margin-bottom:10px}.meta b{margin-right:16px}
table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #94a3b8;padding:3px 6px;text-align:left}th{background:#f1f5f9;text-transform:uppercase;font-size:9.5px}
td.c,th.c{text-align:center}td.b{font-weight:bold;background:#f8fafc}tr.sum td{font-weight:bold;background:#f8fafc}
.foot{display:flex;justify-content:space-between;font-size:12px;font-weight:bold;margin-top:8px;border-top:2px solid #111;padding-top:6px}
@media print{body{padding:8px}}</style></head><body>
<h1>MBM Group</h1><h2>Quality Control In Line / End Line 100% Inspection Report</h2>
<div class="meta"><b>Line: ${esc(QR.line_label || "—")}</b><b>Buyer: ${esc(QR.header?.buyer || "—")}</b><b>Style: ${esc(QR.header?.style || "—")}</b><b>Date: ${esc(QR.date || "—")}</b></div>
<table><thead><tr><th>Defect Name</th><th class="c">Code</th><th class="c">Operator ID</th><th class="c">M/C Code</th>${hrs.map((h) => `<th class="c">${hlabel(h)}</th>`).join("")}<th class="c">TTL</th></tr></thead>
<tbody>${defectRows || `<tr><td colspan="${hrs.length + 5}" style="text-align:center;color:#777">No defects recorded for this line/date.</td></tr>`}${sumRows}</tbody></table>
<div class="foot"><span>TTL Checked: ${T.checked}</span><span>TTL Passed: ${T.passed}</span><span>TTL Defect: ${T.defect}</span><span>TTL Reject: ${T.reject ?? 0}</span><span>Defect %: ${T.defect_pct}%</span></div>
</body></html>`;
  }
  function printQualityReport() {
    const QR = qualityRepQ.data;
    if (!QR) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(qualityReportHtml(QR));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }
  function excelQualityReport() {
    const QR = qualityRepQ.data;
    if (!QR) return;
    const blob = new Blob(["﻿" + qualityReportHtml(QR)], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quality_report_${QR.date}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // date-wise Target vs Output report (behind the Target / Output KPI cards)
  const reportQ = useQuery({
    queryKey: ["target-output-report", repRange.from, repRange.to],
    queryFn: () =>
      api
        .get("/automation/target_output_report/", { params: { from: repRange.from, to: repRange.to } })
        .then((r) => r.data),
    enabled: !!token && drill?.kind === "target_output",
  });

  function reportHtml(R) {
    const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
    const sumRows = R.summary
      .map((r) => `<tr><td>${r.date}</td><td class="r">${r.target}</td><td class="r">${r.output}</td><td class="r">${r.ach_pct}%</td><td class="r">${r.checked}</td><td class="r">${r.defect}</td><td class="r">${r.reject}</td></tr>`)
      .join("");
    const detRows = R.details
      .map((r) => `<tr><td>${r.date}</td><td>${esc(r.style)}</td><td>${esc(r.order_no)}</td><td>${esc(r.po_no)}</td><td>${esc(r.color)}</td><td class="r">${r.bundles}</td><td class="r">${r.checked}</td><td class="r">${r.output}</td><td class="r">${r.defect}</td><td class="r">${r.reject}</td></tr>`)
      .join("");
    return `<html><head><meta charset="utf-8"><title>Target vs Output Report</title>
<style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:14px;margin:18px 0 6px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left}th{background:#f1f5f9;text-transform:uppercase;font-size:10px}td.r,th.r{text-align:right}tfoot td{font-weight:bold;background:#f8fafc}</style></head><body>
<h1>MBM Group — Target vs Output Report</h1>
<div style="font-size:12px;color:#555;margin-top:4px">Period: ${R.from} to ${R.to}</div>
<h2>Summary — date wise</h2>
<table><thead><tr><th>Date</th><th class="r">Target</th><th class="r">Output</th><th class="r">Achieve %</th><th class="r">Check</th><th class="r">Defect</th><th class="r">Reject</th></tr></thead>
<tbody>${sumRows}</tbody>
<tfoot><tr><td>Total</td><td class="r">${R.totals.target}</td><td class="r">${R.totals.output}</td><td class="r">${R.totals.ach_pct}%</td><td class="r">${R.totals.checked}</td><td class="r">${R.totals.defect}</td><td class="r">${R.totals.reject}</td></tr></tfoot></table>
<h2>Details — style / order / po / color wise</h2>
<table><thead><tr><th>Date</th><th>Style</th><th>Order</th><th>PO</th><th>Color</th><th class="r">Bundles</th><th class="r">Check</th><th class="r">Output</th><th class="r">Defect</th><th class="r">Reject</th></tr></thead>
<tbody>${detRows}</tbody></table>
</body></html>`;
  }
  function printReport() {
    const R = reportQ.data;
    if (!R) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(reportHtml(R));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }
  function excelReport() {
    const R = reportQ.data;
    if (!R) return;
    const blob = new Blob(["﻿" + reportHtml(R)], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `target_output_${R.from}_${R.to}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const view = useMemo(() => {
    if (!D) return null;
    const nowH = new Date().getHours();
    const isToday = D.date === todayISO();
    const current = isToday ? (D.hourly || []).find((h) => h.hour === nowH) : null;
    const alerts = [];
    for (const l of D.lines || []) {
      if (l.target_qty && l.ach_pct < 75) alerts.push({ dot: "🔴", text: `Line ${l.label} ach ${l.ach_pct}% — critical` });
      else if (l.target_qty && l.ach_pct < 90) alerts.push({ dot: "🟡", text: `Line ${l.label} ach ${l.ach_pct}% behind` });
      if (l.dhu_pct > 3) alerts.push({ dot: "🔴", text: `Line ${l.label} DHU ${l.dhu_pct}% > 3%` });
      if (l.station_count && l.active_stations < l.station_count)
        alerts.push({ dot: "🟡", text: `${l.station_count - l.active_stations} station idle on ${l.label}` });
    }
    if (D.npt?.total_minutes > 60) alerts.push({ dot: "🔴", text: `Total NPT ${D.npt.total_minutes} min` });
    if (!alerts.length) alerts.push({ dot: "🟢", text: "No critical production or quality issue" });
    if (D.totals.dhu_pct <= 3) alerts.push({ dot: "🟢", text: `DHU ${D.totals.dhu_pct}% within tolerance` });
    return { nowH, isToday, current, alerts: alerts.slice(0, 5) };
  }, [D]);

  /* ---------------- chart options (compact) ---------------- */
  // Merged chart: hourly Target vs Achieve (bars + dashed target line) with
  // cumulative target / achieve lines on a secondary axis.
  const hourlyOpt = useMemo(() => {
    if (!D || !view) return {};
    const hrs = D.hourly || [];
    let ct = 0;
    let ca = 0;
    const cumT = hrs.map((h) => (ct += h.target));
    const cumA = hrs.map((h) => (!view.isToday || h.hour <= view.nowH ? (ca += h.actual) : null));
    return {
      grid: { left: 44, right: 48, top: 26, bottom: 20 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, left: 44, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 10, color: "#5b6270" } },
      xAxis: { type: "category", data: hrs.map((h) => h.label), ...AXIS, splitLine: { show: false } },
      yAxis: [
        { type: "value", ...AXIS },
        { type: "value", ...AXIS, splitLine: { show: false } },
      ],
      series: [
        { name: "Achieve", type: "bar", data: hrs.map((h) => h.actual), itemStyle: { color: C.blue, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26 },
        { name: "Target", type: "line", data: hrs.map((h) => h.target), lineStyle: { color: C.orange, width: 2, type: "dashed" }, itemStyle: { color: C.orange }, symbolSize: 6 },
        { name: "Cum. target", type: "line", yAxisIndex: 1, data: cumT, lineStyle: { color: "#94a3b8", width: 1.5 }, itemStyle: { color: "#94a3b8" }, symbolSize: 4 },
        { name: "Cum. achieve", type: "line", yAxisIndex: 1, data: cumA, lineStyle: { color: "#10b981", width: 2.5 }, itemStyle: { color: "#10b981" }, symbolSize: 5, areaStyle: { color: "rgba(16,185,129,0.10)" } },
      ],
    };
  }, [D, view]);

  if (isLoading && !D) {
    return (
      <div className="space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }
  if (isError || !D) {
    return <div className="rounded-2xl bg-rose-50 p-6 text-sm text-rose-700 ring-1 ring-rose-200">Could not load floor overview.</div>;
  }

  const T = D.totals;
  const { alerts, current } = view;

  return (
    <div
      ref={shellRef}
      className="-m-4"
      style={{
        height: fit.height ?? undefined,
        overflow: "hidden",
        background:
          "linear-gradient(155deg, #edf3fb 0%, #f3effb 38%, #eefaf3 72%, #fdf6ec 100%)",
      }}
    >
      <div
        ref={contentRef}
        className="relative flex flex-col gap-2 p-2"
        style={{ width: DESIGN_W, height: fit.designH ?? undefined, transform: `scale(${fit.scale})`, transformOrigin: "top left" }}
      >
      {/* ============ slim header ============ */}
      <div
        ref={headerRef}
        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-slate-900 via-[#15346b] to-[#2a78d6] px-5 py-2.5 text-white ring-1 ring-white/10"
        style={{ boxShadow: "0 14px 26px -12px rgba(21,52,107,0.65), inset 0 1px 0 rgba(255,255,255,0.18)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-sky-300">MBM Group ERP</span>
          <h1 className="text-[15px] font-semibold tracking-tight">Live Production &amp; Quality Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-full border border-white/30 bg-white/15 px-2.5 py-0.5 font-medium text-white" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            {clock || "—"}
          </span>
          <span className="rounded-full border border-white/30 bg-white/15 px-2.5 py-1 font-medium">Live · 8s</span>
        </div>
      </div>

      {/* ============ KPI strip ============ */}
      <div ref={kpiRef} className="grid grid-cols-4 gap-2 xl:grid-cols-7">
        <Kpi label="Target" value={fmt(T.target)} suffix="pcs" icon={Target} grad="bg-gradient-to-br from-sky-500 to-blue-700" onClick={() => { setRepRange({ from: date, to: date }); setDrill({ kind: "target_output", title: "Target vs Output Report" }); }} />
        <Kpi label="Output" value={fmt(T.output)} suffix="pcs" icon={Factory} grad="bg-gradient-to-br from-indigo-500 to-violet-700" spark={T.target ? (T.output / T.target) * 100 : 0} onClick={() => { setRepRange({ from: date, to: date }); setDrill({ kind: "target_output", title: "Target vs Output Report" }); }} />
        {/* merged Achieve + Total DHU card: defect vs pass rate */}
        <div
          onClick={() => { setQr({ date, line: null }); setDrill({ kind: "quality_report", title: "Quality Inspection Report" }); }}
          style={KPI_SHADOW}
          className={`relative col-span-2 cursor-pointer overflow-hidden rounded-2xl px-3 py-2 text-white ring-1 ring-white/20 transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 active:scale-[0.98] ${
            T.dhu_pct <= 3 ? "bg-gradient-to-br from-teal-500 to-emerald-700" : "bg-gradient-to-br from-orange-500 to-rose-600"
          }`}
        >
          <div className="absolute -right-3 -top-3 h-14 w-14 rounded-full bg-white/10" />
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-white/75">Defect vs Pass Rate</span>
            <ShieldCheck className="h-3.5 w-3.5 opacity-80" />
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg bg-white/15 py-1">
              <div className="text-[8px] font-extrabold uppercase tracking-wider text-white/70">Check</div>
              <div className="text-[16px] font-bold leading-tight drop-shadow-sm">{fmt(T.checked)}</div>
              <div className="text-[9px] font-semibold text-white/80">qty</div>
            </div>
            <div className="rounded-lg bg-white/15 py-1">
              <div className="text-[8px] font-extrabold uppercase tracking-wider text-white/70">Defect</div>
              <div className="text-[16px] font-bold leading-tight drop-shadow-sm">{fmt(T.defect)}</div>
              <div className="text-[9px] font-semibold text-white/80">{T.dhu_pct.toFixed(2)}%</div>
            </div>
            <div className="rounded-lg bg-white/15 py-1">
              <div className="text-[8px] font-extrabold uppercase tracking-wider text-white/70">Pass</div>
              <div className="text-[16px] font-bold leading-tight drop-shadow-sm">{fmt(T.passed ?? 0)}</div>
              <div className="text-[9px] font-semibold text-white/80">{T.rft_pct.toFixed(1)}%</div>
            </div>
          </div>
        </div>
        <Kpi label="Reject" value={T.reject_pct.toFixed(2)} suffix="%" icon={XCircle} grad="bg-gradient-to-br from-rose-500 to-pink-700" />
        <Kpi label="Stations" value={T.active_stations} suffix={`/${T.station_count}`} icon={Users} grad="bg-gradient-to-br from-fuchsia-500 to-purple-700" spark={T.station_count ? (T.active_stations / T.station_count) * 100 : 0} />
        <Kpi label="NPT" value={fmt(D.npt?.total_minutes)} suffix="min" icon={TimerOff} grad={(D.npt?.total_minutes || 0) > 60 ? "bg-gradient-to-br from-red-500 to-rose-700" : "bg-gradient-to-br from-slate-500 to-slate-700"} />
      </div>

      {/* ============ alert ticker ============ */}
      <div ref={alertsRef} className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          <AlertTriangle className="h-3 w-3" /> Alerts
        </span>
        {alerts.map((a, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm ring-1 ring-slate-200">
            <span className="text-[10px]">{a.dot}</span>
            {a.text}
          </span>
        ))}
      </div>

      {/* ============ charts row: merged hourly chart + line performance 50/50 ============ */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2" style={{ height: fit.chartRowH }}>
        <Panel
          stripe="bg-gradient-to-r from-sky-400 to-blue-600"
          tint="sky"
          icon={Clock3}
          title="Hourly Target vs Achieve"
          right={
            <span className="text-[10px] font-semibold text-slate-400">
              {current ? `Hr target ${fmt(current.target)} · Hr pass ${fmt(current.actual)} · ` : ""}
              Day {fmt(T.output)}/{fmt(T.target)}
            </span>
          }
        >
          <ReactECharts option={hourlyOpt} style={{ height: Math.max(140, fit.chartRowH - 48) }} notMerge />
        </Panel>
        <Panel stripe="bg-gradient-to-r from-violet-400 to-fuchsia-500" tint="violet" icon={Factory} title="Line Performance">
          <div className="overflow-auto" style={{ maxHeight: Math.max(140, fit.chartRowH - 48) }}>
            <table className="min-w-full text-[11.5px]">
              <thead className="text-left text-[9.5px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-1.5 py-1">Line</th>
                  <th className="px-1.5 py-1">Style</th>
                  <th className="px-1.5 py-1 text-right">Tgt</th>
                  <th className="px-1.5 py-1 text-right">Out</th>
                  <th className="px-1.5 py-1 w-24">Ach</th>
                  <th className="px-1.5 py-1 text-right">DHU</th>
                  <th className="px-1.5 py-1 text-right">RFT</th>
                  <th className="px-1.5 py-1">St</th>
                  <th className="px-1.5 py-1 text-right">Stn</th>
                </tr>
              </thead>
              <tbody>
                {(D.lines || []).map((l) => {
                  const g = achTone(l.ach_pct);
                  return (
                    <tr key={`${l.floor}-${l.line}`} className="border-t border-slate-100 hover:bg-violet-50/40">
                      <td className="px-1.5 py-1.5">
                        <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">{l.label}</span>
                      </td>
                      <td className="max-w-[130px] truncate px-1.5 py-1.5 text-slate-600" title={l.style}>{l.style || "—"}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{fmt(l.target_qty)}</td>
                      <td className="px-1.5 py-1.5 text-right font-bold tabular-nums text-slate-800">{fmt(l.output)}</td>
                      <td className="px-1.5 py-1.5">
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-100">
                            <div className={`h-full rounded ${g.bar}`} style={{ width: `${Math.min(100, l.ach_pct)}%` }} />
                          </div>
                          <b className={`text-[10px] tabular-nums ${g.text}`}>{l.ach_pct}%</b>
                        </div>
                      </td>
                      <td className={`px-1.5 py-1.5 text-right font-semibold tabular-nums ${dhuTone(l.dhu_pct)}`}>{l.dhu_pct}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{l.rft_pct}</td>
                      <td className="px-1.5 py-1.5 text-sm leading-none">{g.dot}</td>
                      <td className="px-1.5 py-1.5 text-right tabular-nums">{l.active_stations}/{l.station_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* last-hour performers: operator photos from HR (hr_as_basic_info) */}
          {(() => {
            const P = D.performers;
            if (!P || (!P.good?.length && !P.bad?.length)) return null;
            const hh = P.hour != null ? `${String(P.hour).padStart(2, "0")}–${String((P.hour + 1) % 24).padStart(2, "0")}` : "";
            const Person = ({ p, good }) => (
              <div className={`flex items-center gap-2 rounded-xl p-1.5 ring-1 ${good ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"}`}>
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt=""
                    onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "grid"; }}
                    className={`h-10 w-10 shrink-0 rounded-full object-cover ring-2 ${good ? "ring-emerald-400" : "ring-rose-400"}`}
                  />
                ) : null}
                <span
                  style={{ display: p.photo ? "none" : "grid" }}
                  className={`h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white ${good ? "bg-emerald-500" : "bg-rose-500"}`}
                >
                  {(p.name || `M${p.machin_id}`).charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-slate-800" title={p.name || ""}>
                    {p.name || "Unknown operator"}
                  </span>
                  <span className={`block truncate text-[10px] font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
                    M{p.machin_id} · {p.reason}
                  </span>
                </span>
              </div>
            );
            return (
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                <div>
                  <div className="mb-1 text-[9.5px] font-extrabold uppercase tracking-wider text-emerald-600">
                    ★ Good — hour {hh}
                  </div>
                  <div className="space-y-1.5">
                    {(P.good || []).map((p) => <Person key={`g${p.machin_id}`} p={p} good />)}
                    {!P.good?.length ? <div className="text-[10px] text-slate-400">No defect-free top performer this hour</div> : null}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[9.5px] font-extrabold uppercase tracking-wider text-rose-600">
                    ⚠ Needs attention
                  </div>
                  <div className="space-y-1.5">
                    {(P.bad || []).map((p) => <Person key={`b${p.machin_id}`} p={p} />)}
                    {!P.bad?.length ? <div className="text-[10px] text-slate-400">No low output / defect issue</div> : null}
                  </div>
                </div>
              </div>
            );
          })()}
        </Panel>
      </div>

      {/* ============ bottom row ============ */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3" style={{ height: fit.bottomRowH }}>
        <Panel
          stripe="bg-gradient-to-r from-emerald-400 to-lime-500"
          tint="emerald"
          icon={BadgeCheck}
          title="Quality — End Line & Station Wise"
          className="lg:col-span-2"
          right={<span className="text-[10px] font-semibold text-slate-400">Today · from QC records</span>}
        >
          <div className="grid h-full grid-cols-2 gap-2">
            {/* End-line quality: two headline %s + bars scaled to check qty */}
            <div className="flex min-h-0 flex-col justify-center gap-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div className={`rounded-xl py-1.5 text-center ring-1 ${T.rft_pct >= 95 ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
                  <div className={`text-[9px] font-extrabold uppercase tracking-wider ${T.rft_pct >= 95 ? "text-emerald-600" : "text-amber-600"}`}>
                    RFT · Right First Time
                  </div>
                  <div className={`text-[26px] font-bold leading-tight tabular-nums ${T.rft_pct >= 95 ? "text-emerald-700" : "text-amber-700"}`}>
                    {T.rft_pct.toFixed(1)}%
                  </div>
                </div>
                <div className={`rounded-xl py-1.5 text-center ring-1 ${T.dhu_pct <= 3 ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"}`}>
                  <div className={`text-[9px] font-extrabold uppercase tracking-wider ${T.dhu_pct <= 3 ? "text-emerald-600" : "text-rose-600"}`}>
                    DHU · Defects/Hundred
                  </div>
                  <div className={`text-[26px] font-bold leading-tight tabular-nums ${T.dhu_pct <= 3 ? "text-emerald-700" : "text-rose-700"}`}>
                    {T.dhu_pct.toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Check", v: T.checked, bar: "bg-sky-500", text: "text-sky-700" },
                  { label: "Pass", v: T.passed ?? 0, bar: "bg-emerald-500", text: "text-emerald-700" },
                  { label: "Defect", v: T.defect, bar: "bg-amber-500", text: "text-amber-700" },
                  { label: "Reject", v: T.reject, bar: "bg-rose-500", text: "text-rose-700" },
                ].map((r) => {
                  const pct = T.checked ? Math.min(100, (r.v / T.checked) * 100) : 0;
                  return (
                    <div key={r.label} className="flex items-center gap-2">
                      <span className="w-11 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{r.label}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-md bg-slate-100">
                        <div className={`h-full rounded-md ${r.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`w-24 shrink-0 text-right text-[11px] font-bold tabular-nums ${r.text}`}>
                        {fmt(r.v)} pcs · {pct.toFixed(pct > 0 && pct < 10 ? 1 : 0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Station-wise defect / reject / DHU */}
            <div className="overflow-auto rounded-lg ring-1 ring-slate-100">
              <table className="min-w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-50 text-left text-[9.5px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-2 py-1">Station</th>
                    <th className="px-2 py-1 text-right">Scan</th>
                    <th className="px-2 py-1 text-right">Defect</th>
                    <th className="px-2 py-1 text-right">Reject</th>
                    <th className="px-2 py-1 text-right">DHU%</th>
                  </tr>
                </thead>
                <tbody>
                  {(D.machines || []).map((m) => (
                    <tr key={m.machin_id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-bold text-slate-700">M{m.machin_id}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">{fmt(m.scanned)}</td>
                      <td className={`px-2 py-1 text-right font-bold tabular-nums ${m.defect > 0 ? "text-amber-700" : "text-slate-400"}`}>{fmt(m.defect)}</td>
                      <td className={`px-2 py-1 text-right font-bold tabular-nums ${m.reject > 0 ? "text-rose-700" : "text-slate-400"}`}>{fmt(m.reject)}</td>
                      <td className="px-2 py-1 text-right">
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${m.dhu_pct <= 3 ? "bg-emerald-50 text-emerald-700" : m.dhu_pct <= 5 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
                          {m.dhu_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>

        <Panel
          stripe="bg-gradient-to-r from-violet-400 to-purple-600"
          tint="purple"
          icon={TimerOff}
          title="NPT — Non Productive Time"
          right={
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold ${(D.npt?.total_minutes || 0) > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
              Total {D.npt?.total_minutes ?? 0} min
            </span>
          }
        >
          {(D.npt?.total_minutes || 0) > 0 || (D.npt?.events || 0) > 0 ? (
            <div className="flex h-full min-h-0 flex-col gap-1.5">
              {/* summary: total / events / running now */}
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="rounded-lg bg-rose-50 py-1 ring-1 ring-rose-100">
                  <div className="text-[8.5px] font-extrabold uppercase tracking-wider text-rose-600">Total</div>
                  <div className="text-[16px] font-bold leading-tight text-rose-700 tabular-nums">{D.npt.total_minutes}<span className="text-[10px] font-semibold"> min</span></div>
                </div>
                <div className="rounded-lg bg-slate-50 py-1 ring-1 ring-slate-100">
                  <div className="text-[8.5px] font-extrabold uppercase tracking-wider text-slate-500">Events</div>
                  <div className="text-[16px] font-bold leading-tight text-slate-700 tabular-nums">{D.npt.events ?? 0}</div>
                </div>
                <div className={`rounded-lg py-1 ring-1 ${(D.npt.open_events || 0) > 0 ? "bg-amber-50 ring-amber-200" : "bg-emerald-50 ring-emerald-100"}`}>
                  <div className={`text-[8.5px] font-extrabold uppercase tracking-wider ${(D.npt.open_events || 0) > 0 ? "text-amber-600" : "text-emerald-600"}`}>Running</div>
                  <div className={`text-[16px] font-bold leading-tight tabular-nums ${(D.npt.open_events || 0) > 0 ? "animate-pulse text-amber-700" : "text-emerald-700"}`}>{D.npt.open_events ?? 0}</div>
                </div>
              </div>
              {/* category breakdown with share bars */}
              <div className="min-h-0 flex-1 space-y-1 overflow-auto">
                {(D.npt.categories || []).map((c) => {
                  const share = D.npt.total_minutes ? Math.min(100, (c.minutes / D.npt.total_minutes) * 100) : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="truncate font-semibold text-slate-600" title={c.category}>{c.category}</span>
                        <b className="ml-1 shrink-0 tabular-nums text-slate-800">{c.minutes}m · {c.events ?? 0} ev</b>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-slate-100">
                        <div className="h-full rounded bg-violet-500" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* station-wise NPT chips */}
              {(D.npt.machines || []).length ? (
                <div className="flex flex-wrap gap-1">
                  {(D.npt.machines || []).slice(0, 5).map((m) => (
                    <span key={m.machin_id} className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9.5px] font-bold text-violet-700 ring-1 ring-violet-100">
                      M{m.machin_id} · {m.minutes}m
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 rounded-lg bg-emerald-50 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
              <CheckCircle2 className="h-4 w-4" />
              No NPT today — full time productive
            </div>
          )}
        </Panel>
      </div>

      {/* ============ drill-down modal ============ */}
      {drill ? (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-6" onClick={() => setDrill(null)}>
          <div className={`max-h-[85%] w-full overflow-hidden rounded-2xl bg-white shadow-2xl ${drill.kind === "target_output" ? "max-w-5xl" : drill.kind === "quality_report" ? "max-w-6xl" : "max-w-4xl"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-bold text-slate-800">
                {drill.title}{" "}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {drill.kind === "target_output" ? `${repRange.from} → ${repRange.to}` : drill.kind === "quality_report" ? qr.date : D.date}
                </span>
              </div>
              <button type="button" onClick={() => setDrill(null)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">✕ Close</button>
            </div>
            <div className="max-h-[480px] overflow-auto p-3">
              {drill.kind === "quality_report" ? (
                (() => {
                  const QR = qualityRepQ.data;
                  return (
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <label className="text-[11px] font-bold uppercase text-slate-500">Date</label>
                        <input type="date" value={qr.date} onChange={(e) => setQr((p) => ({ ...p, date: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                        <label className="text-[11px] font-bold uppercase text-slate-500">Line</label>
                        <select
                          value={qr.line ? `${qr.line.floor}-${qr.line.line}` : ""}
                          onChange={(e) => { const [f, l] = e.target.value.split("-").map(Number); setQr((p) => ({ ...p, line: { floor: f, line: l } })); }}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          {(QR?.lines ?? []).map((l) => (
                            <option key={`${l.floor}-${l.line}`} value={`${l.floor}-${l.line}`}>Line {l.label}</option>
                          ))}
                        </select>
                        <span className="flex-1" />
                        <button type="button" onClick={printQualityReport} disabled={!QR} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40">🖨 Print</button>
                        <button type="button" onClick={excelQualityReport} disabled={!QR} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">⬇ Excel</button>
                      </div>
                      {qualityRepQ.isFetching && !QR ? (
                        <div className="p-6 text-center text-sm text-slate-400">Loading report…</div>
                      ) : QR ? (
                        <div className="overflow-hidden rounded-xl border border-slate-200">
                          <div className="border-b-2 border-slate-800 px-4 py-3 text-center">
                            <div className="text-lg font-bold tracking-tight text-slate-900">MBM Group</div>
                            <div className="text-[13px] font-semibold text-slate-700">Quality Control In Line / End Line 100% Inspection Report</div>
                            <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[12px] text-slate-600">
                              <span>Line: <b className="text-slate-900">{QR.line_label ?? "—"}</b></span>
                              <span>Buyer: <b className="text-slate-900">{QR.header?.buyer ?? "—"}</b></span>
                              <span className="max-w-[380px] truncate">Style: <b className="text-slate-900">{QR.header?.style ?? "—"}</b></span>
                              <span>Date: <b className="text-slate-900">{QR.date ?? "—"}</b></span>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-[12px]">
                              <thead>
                                <tr className="bg-slate-100 text-[10.5px] uppercase tracking-wide text-slate-600">
                                  <th className="border border-slate-200 px-2 py-2 text-left">Defect Name</th>
                                  <th className="border border-slate-200 px-2 py-2">Code</th>
                                  <th className="border border-slate-200 px-2 py-2">Operator ID</th>
                                  <th className="border border-slate-200 px-2 py-2">M/C Code</th>
                                  {(QR.hours ?? []).map((h) => (
                                    <th key={h} className="border border-slate-200 px-1.5 py-2 text-center">
                                      {String(h).padStart(2, "0")}–{String((h + 1) % 24).padStart(2, "0")}
                                    </th>
                                  ))}
                                  <th className="border border-slate-200 bg-slate-200 px-2 py-2 text-center">TTL</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(QR.defect_rows ?? []).map((r, i) => (
                                  <tr key={i} className="hover:bg-amber-50/40">
                                    <td className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-800">{r.defect_name}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{r.defect_code || "—"}</span>
                                    </td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums text-slate-700">{r.operator_id || "—"}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-center">
                                      {r.machin_id ? <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">M{r.machin_id}{r.machin_code ? ` · ${r.machin_code}` : ""}</span> : "—"}
                                    </td>
                                    {(QR.hours ?? []).map((h) => {
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
                                {!(QR.defect_rows ?? []).length ? (
                                  <tr>
                                    <td colSpan={(QR.hours?.length ?? 10) + 5} className="border border-slate-200 px-3 py-5 text-center text-slate-400">
                                      No defects recorded for this line/date.
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                              <tfoot className="text-[12px]">
                                {(() => {
                                  const hrs = QR.hours ?? [];
                                  const S = QR.summary ?? {};
                                  const T = QR.totals ?? { checked: 0, passed: 0, defect: 0, defect_pct: 0 };
                                  let cumC = 0, cumP = 0, cumD = 0;
                                  const rows = [
                                    { label: "Total Checked / Cum", cls: "text-slate-800", get: (h) => { const v = S[String(h)]?.checked || 0; cumC += v; return v ? `${v}/${cumC}` : "·"; }, total: T.checked },
                                    { label: "Total Passed / Cum", cls: "text-emerald-700", get: (h) => { const v = S[String(h)]?.passed || 0; cumP += v; return v ? `${v}/${cumP}` : "·"; }, total: T.passed },
                                    { label: "Total Defect / Cum", cls: "text-rose-700", get: (h) => { const v = S[String(h)]?.defect || 0; cumD += v; return v ? `${v}/${cumD}` : "·"; }, total: T.defect },
                                    { label: "Hourly Defect %", cls: "text-amber-700", get: (h) => { const c = S[String(h)]?.checked || 0; const dv = S[String(h)]?.defect || 0; return c ? `${((dv * 100) / c).toFixed(1)}%` : "·"; }, total: `${T.defect_pct}%` },
                                  ];
                                  return rows.map((row) => (
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
                            <span>TTL Checked: <b className="text-slate-900">{QR.totals?.checked ?? 0}</b></span>
                            <span>TTL Passed: <b className="text-emerald-700">{QR.totals?.passed ?? 0}</b></span>
                            <span>TTL Defect: <b className="text-rose-700">{QR.totals?.defect ?? 0}</b></span>
                            <span>TTL Reject: <b className="text-rose-700">{QR.totals?.reject ?? 0}</b></span>
                            <span>Defect %: <b className="text-amber-700">{QR.totals?.defect_pct ?? 0}%</b></span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : drill.kind === "target_output" ? (
                <div>
                  {/* range + export controls */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-bold uppercase text-slate-500">From</label>
                    <input type="date" value={repRange.from} onChange={(e) => setRepRange((p) => ({ ...p, from: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                    <label className="text-[11px] font-bold uppercase text-slate-500">To</label>
                    <input type="date" value={repRange.to} onChange={(e) => setRepRange((p) => ({ ...p, to: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                    <span className="flex-1" />
                    <button type="button" onClick={printReport} disabled={!reportQ.data} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40">🖨 Print</button>
                    <button type="button" onClick={excelReport} disabled={!reportQ.data} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">⬇ Excel</button>
                  </div>
                  {reportQ.isFetching ? (
                    <div className="p-6 text-center text-sm text-slate-400">Loading report…</div>
                  ) : reportQ.data ? (
                    <>
                      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-sky-700">Summary — date wise</div>
                      <table className="mb-4 min-w-full text-[12px]">
                        <thead className="bg-sky-50 text-left text-[10px] uppercase tracking-wide text-sky-700">
                          <tr><th className="px-2 py-2">Date</th><th className="px-2 py-2 text-right">Target</th><th className="px-2 py-2 text-right">Output</th><th className="px-2 py-2 text-right">Achieve %</th><th className="px-2 py-2 text-right">Check</th><th className="px-2 py-2 text-right">Defect</th><th className="px-2 py-2 text-right">Reject</th></tr>
                        </thead>
                        <tbody>
                          {reportQ.data.summary.map((r) => (
                            <tr key={r.date} className="border-t border-slate-100">
                              <td className="px-2 py-1.5 font-semibold text-slate-800">{r.date}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.target)}</td>
                              <td className="px-2 py-1.5 text-right font-bold tabular-nums text-indigo-700">{fmt(r.output)}</td>
                              <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${r.ach_pct >= 90 ? "text-emerald-600" : "text-rose-600"}`}>{r.ach_pct}%</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.checked)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{fmt(r.defect)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{fmt(r.reject)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                            <td className="px-2 py-1.5">Total</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(reportQ.data.totals.target)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-indigo-700">{fmt(reportQ.data.totals.output)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{reportQ.data.totals.ach_pct}%</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(reportQ.data.totals.checked)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{fmt(reportQ.data.totals.defect)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{fmt(reportQ.data.totals.reject)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-violet-700">Details — style / order / po / color wise</div>
                      <table className="min-w-full text-[12px]">
                        <thead className="sticky top-0 bg-violet-50 text-left text-[10px] uppercase tracking-wide text-violet-700">
                          <tr><th className="px-2 py-2">Date</th><th className="px-2 py-2">Style</th><th className="px-2 py-2">Order</th><th className="px-2 py-2">PO</th><th className="px-2 py-2">Color</th><th className="px-2 py-2 text-right">Bundles</th><th className="px-2 py-2 text-right">Check</th><th className="px-2 py-2 text-right">Output</th><th className="px-2 py-2 text-right">Defect</th><th className="px-2 py-2 text-right">Reject</th></tr>
                        </thead>
                        <tbody>
                          {reportQ.data.details.map((r, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-2 py-1.5 tabular-nums">{r.date}</td>
                              <td className="max-w-[180px] truncate px-2 py-1.5 font-semibold text-slate-800" title={r.style}>{r.style}</td>
                              <td className="px-2 py-1.5">{r.order_no}</td>
                              <td className="px-2 py-1.5">{r.po_no}</td>
                              <td className="px-2 py-1.5">{r.color}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{r.bundles}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.checked)}</td>
                              <td className="px-2 py-1.5 text-right font-bold tabular-nums text-indigo-700">{fmt(r.output)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{fmt(r.defect)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{fmt(r.reject)}</td>
                            </tr>
                          ))}
                          {!reportQ.data.details.length ? (
                            <tr><td colSpan={10} className="p-4 text-center text-slate-400">No QC data in this date range</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </>
                  ) : null}
                </div>
              ) : drillQ.isFetching ? (
                <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
              ) : drill.kind === "output" ? (
                <table className="min-w-full text-[12px]">
                  <thead className="sticky top-0 bg-sky-50 text-left text-[10px] uppercase tracking-wide text-sky-700">
                    <tr><th className="px-2 py-2">Style</th><th className="px-2 py-2">Order</th><th className="px-2 py-2">PO</th><th className="px-2 py-2 text-right">Bundles</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Pass</th><th className="px-2 py-2 text-right">Defect</th><th className="px-2 py-2 text-right">Reject</th></tr>
                  </thead>
                  <tbody>
                    {(drillQ.data?.rows ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="max-w-[200px] truncate px-2 py-1.5 font-semibold text-slate-800" title={r.style}>{r.style}</td>
                        <td className="px-2 py-1.5">{r.order_no}</td>
                        <td className="px-2 py-1.5">{r.po_no}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.bundles}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.qty)}</td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums text-emerald-700">{fmt(r.pass_qty)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-600">{fmt(r.defect)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-rose-600">{fmt(r.reject)}</td>
                      </tr>
                    ))}
                    {!(drillQ.data?.rows ?? []).length ? (<tr><td colSpan={8} className="p-5 text-center text-slate-400">No data for this date.</td></tr>) : null}
                  </tbody>
                </table>
              ) : drill.kind === "defect" ? (
                <table className="min-w-full text-[12px]">
                  <thead className="sticky top-0 bg-amber-50 text-left text-[10px] uppercase tracking-wide text-amber-700">
                    <tr><th className="px-2 py-2">Process / Part</th><th className="px-2 py-2">Bundle</th><th className="px-2 py-2">Defect</th><th className="px-2 py-2 text-right">Pcs</th><th className="px-2 py-2">Machine</th><th className="px-2 py-2">Operator</th><th className="px-2 py-2">Hour</th></tr>
                  </thead>
                  <tbody>
                    {(drillQ.data?.rows ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-semibold uppercase text-slate-800">{r.process}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.bundle_id}</td>
                        <td className="px-2 py-1.5"><span className="mr-1 rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{r.defect_code}</span>{r.defect_name}</td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums text-amber-700">{r.pcs}</td>
                        <td className="px-2 py-1.5">{r.machin_id ? `M${r.machin_id}${r.machin_code ? " · " + r.machin_code : ""}` : "—"}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.operator_id || "—"}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.hour}</td>
                      </tr>
                    ))}
                    {!(drillQ.data?.rows ?? []).length ? (<tr><td colSpan={7} className="p-5 text-center text-slate-400">No defects for this date 🎉</td></tr>) : null}
                  </tbody>
                </table>
              ) : (
                <table className="min-w-full text-[12px]">
                  <thead className="sticky top-0 bg-rose-50 text-left text-[10px] uppercase tracking-wide text-rose-700">
                    <tr><th className="px-2 py-2">Bundle</th><th className="px-2 py-2">Style</th><th className="px-2 py-2">Process</th><th className="px-2 py-2">Order</th><th className="px-2 py-2">PO</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Pass</th><th className="px-2 py-2 text-right">Reject</th></tr>
                  </thead>
                  <tbody>
                    {(drillQ.data?.rows ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.bundle_id}</td>
                        <td className="max-w-[160px] truncate px-2 py-1.5 font-semibold text-slate-800" title={r.style}>{r.style}</td>
                        <td className="px-2 py-1.5 uppercase">{r.process}</td>
                        <td className="px-2 py-1.5">{r.order_no}</td>
                        <td className="px-2 py-1.5">{r.po_no}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.qty)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{fmt(r.pass_qty)}</td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums text-rose-600">{fmt(r.reject)}</td>
                      </tr>
                    ))}
                    {!(drillQ.data?.rows ?? []).length ? (<tr><td colSpan={8} className="p-5 text-center text-slate-400">No rejected bundles for this date 🎉</td></tr>) : null}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ============ machine × hour output matrix ============ */}
      <div ref={matrixRef}>
      <Panel
        stripe="bg-gradient-to-r from-blue-500 to-indigo-600"
        tint="indigo"
        icon={Cpu}
        title="Machine Hourly Output"
        right={<span className="text-[10px] font-semibold text-slate-400">pcs at each hour end</span>}
      >
        {(() => {
          const slots = D.hourly || [];
          const rows = D.machine_hours || [];
          const maxCell = Math.max(1, ...rows.flatMap((m) => slots.map((h) => m.by_hour[String(h.hour)] || 0)));
          return (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[11.5px]">
                <thead className="text-[9.5px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-2 py-1 text-left">Machine</th>
                    {slots.map((h) => (
                      <th key={h.hour} className="px-1.5 py-1 text-center">
                        {h.label}
                        {h.overtime ? <span className="ml-0.5 rounded bg-violet-100 px-0.5 text-[8px] font-bold text-violet-700">OT</span> : null}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.machin_id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">M{m.machin_id}</span>
                      </td>
                      {slots.map((h) => {
                        const v = m.by_hour[String(h.hour)] || 0;
                        const alpha = v ? 0.1 + 0.45 * (v / maxCell) : 0;
                        return (
                          <td
                            key={h.hour}
                            className="px-1.5 py-1.5 text-center font-semibold tabular-nums text-slate-800"
                            style={{ backgroundColor: v ? `rgba(42,120,214,${alpha.toFixed(2)})` : undefined }}
                            title={`M${m.machin_id} · ${h.label}: ${v} pcs`}
                          >
                            {v || <span className="text-slate-300">·</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right text-[12px] font-bold tabular-nums text-blue-700">{fmt(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-800">
                    <td className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">Line total</td>
                    {slots.map((h) => {
                      const colTotal = rows.reduce((a, m) => a + (m.by_hour[String(h.hour)] || 0), 0);
                      return (
                        <td key={h.hour} className="px-1.5 py-1.5 text-center tabular-nums">
                          {colTotal || <span className="text-slate-300">·</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right tabular-nums text-blue-800">
                      {fmt(rows.reduce((a, m) => a + (m.total || 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })()}
      </Panel>
      </div>
      </div>
    </div>
  );
}
