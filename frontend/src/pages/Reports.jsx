import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Reports() {
  const token = useAuthStore((s) => s.accessToken);
  // deep-link support: /reports?tab=quality&date=YYYY-MM-DD (dashboard cards)
  const [urlParams] = useSearchParams();
  const [tab, setTab] = useState(urlParams.get("tab") || "daily");
  const [date, setDate] = useState(urlParams.get("date") || todayISO());
  const [lineId, setLineId] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState("");
  const [mismatchEmp, setMismatchEmp] = useState("");
  const [mismatchLine, setMismatchLine] = useState("");

  const { data: lines } = useQuery({
    queryKey: ["lines"],
    queryFn: () => api.get("/floors/lines/").then((r) => r.data),
    enabled: !!token,
  });

  const daily = useQuery({
    queryKey: ["report-daily", date],
    queryFn: () => api.get("/reports/daily/", { params: { date } }).then((r) => r.data),
    enabled: !!token && tab === "daily",
  });

  const hourly = useQuery({
    queryKey: ["report-hourly", lineId, date],
    queryFn: () => api.get("/reports/hourly/", { params: { line_id: lineId, date } }).then((r) => r.data),
    enabled: !!token && tab === "hourly" && !!lineId,
  });

  const eff = useQuery({
    queryKey: ["report-eff", from, to, employeeId],
    queryFn: () =>
      api
        .get("/reports/efficiency/", {
          params: {
            date_from: from,
            date_to: to,
            employee_id: employeeId ? Number(employeeId) : undefined,
          },
        })
        .then((r) => r.data),
    enabled: !!token && tab === "efficiency",
  });

  const [qDate, setQDate] = useState(urlParams.get("date") || todayISO());
  const [qLine, setQLine] = useState(null); // {floor, line}
  const quality = useQuery({
    queryKey: ["report-quality", qDate, qLine?.floor, qLine?.line],
    queryFn: () =>
      api
        .get("/reports/quality/", {
          params: { date: qDate, floor: qLine?.floor, line: qLine?.line },
        })
        .then((r) => r.data),
    enabled: !!token && tab === "quality",
  });

  const mismatch = useQuery({
    queryKey: ["report-mismatch", from, to, mismatchEmp, mismatchLine],
    queryFn: () =>
      api
        .get("/reports/mismatch/", {
          params: {
            date_from: from,
            date_to: to,
            employee_id: mismatchEmp ? Number(mismatchEmp) : undefined,
            line_id: mismatchLine ? Number(mismatchLine) : undefined,
          },
        })
        .then((r) => r.data),
    enabled: !!token && tab === "mismatch",
  });

  const barOption = useMemo(() => {
    const rows = daily.data?.lines ?? [];
    return {
      grid: { left: 48, right: 16, top: 24, bottom: 64 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: rows.map((r) => r.line_name), axisLabel: { rotate: 30 } },
      yAxis: { type: "value" },
      series: [
        { name: "Target", type: "bar", data: rows.map((r) => r.target), itemStyle: { color: "#94A3B8" } },
        { name: "Actual", type: "bar", data: rows.map((r) => r.actual), itemStyle: { color: "#2563EB" } },
      ],
    };
  }, [daily.data]);

  const hourlyLineOption = useMemo(() => {
    const hours = hourly.data?.hours ?? [];
    return {
      grid: { left: 40, right: 16, top: 24, bottom: 32 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: hours.map((h) => `${h.hour}:00`) },
      yAxis: { type: "value" },
      series: [
        {
          name: "Quantity",
          type: "line",
          data: hours.map((h) => h.quantity),
          smooth: true,
          itemStyle: { color: "#2563EB" },
        },
        {
          name: "Target",
          type: "line",
          data: hours.map((h) => h.target),
          smooth: true,
          lineStyle: { type: "dashed" },
          itemStyle: { color: "#F59E0B" },
        },
      ],
    };
  }, [hourly.data]);

  async function download(kind) {
    const res = await api.get(kind === "xlsx" ? "/reports/export/daily.xlsx" : "/reports/export/daily.pdf", {
      params: { date },
      responseType: "blob",
    });
    const blob = new Blob([res.data]);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "xlsx" ? `daily-${date}.xlsx` : `daily-${date}.pdf`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const tabs = [
    { id: "daily", label: "Daily line" },
    { id: "hourly", label: "Hourly production" },
    { id: "efficiency", label: "Employee efficiency" },
    { id: "mismatch", label: "Line change / mismatch" },
    { id: "quality", label: "Quality report" },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-600 mt-1">Analytics backed by Django report endpoints.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
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

      {tab === "daily" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-xs text-slate-600">Date</label>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              onClick={() => download("xlsx")}
            >
              Export Excel
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              onClick={() => download("pdf")}
            >
              Export PDF
            </button>
          </div>
          <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Line</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Actual</th>
                  <th className="px-4 py-3">Efficiency %</th>
                  <th className="px-4 py-3">Variance</th>
                </tr>
              </thead>
              <tbody>
                {(daily.data?.lines ?? []).map((r) => (
                  <tr key={r.line_id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.line_name}</td>
                    <td className="px-4 py-3">{r.target}</td>
                    <td className="px-4 py-3">{r.actual}</td>
                    <td className="px-4 py-3">{r.efficiency_pct}</td>
                    <td className="px-4 py-3">{r.variance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h-72 rounded-2xl bg-white border border-slate-100 p-3 shadow-card">
            <ReactECharts option={barOption} style={{ height: "100%" }} notMerge lazyUpdate />
          </div>
        </div>
      ) : null}

      {tab === "hourly" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
            >
              <option value="">Select line…</option>
              {(lines ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="h-80 rounded-2xl bg-white border border-slate-100 p-3 shadow-card">
            <ReactECharts option={hourlyLineOption} style={{ height: "100%" }} notMerge lazyUpdate />
          </div>
        </div>
      ) : null}

      {tab === "efficiency" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <input
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Employee id (optional)"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            />
          </div>
          <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Station</th>
                  <th className="px-4 py-3">Operation</th>
                  <th className="px-4 py-3">SAM</th>
                  <th className="px-4 py-3">Output</th>
                  <th className="px-4 py-3">Efficiency %</th>
                </tr>
              </thead>
              <tbody>
                {(eff.data?.rows ?? []).map((r, idx) => (
                  <tr key={`${r.employee_id}-${idx}`} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      {idx === 0 ? <span className="mr-2">🏅</span> : null}
                      {r.name}
                    </td>
                    <td className="px-4 py-3">{r.station_label}</td>
                    <td className="px-4 py-3">{r.operation}</td>
                    <td className="px-4 py-3">{r.sam}</td>
                    <td className="px-4 py-3">{r.output}</td>
                    <td className="px-4 py-3">{r.efficiency_pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "mismatch" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <input
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Employee id"
              value={mismatchEmp}
              onChange={(e) => setMismatchEmp(e.target.value)}
            />
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={mismatchLine}
              onChange={(e) => setMismatchLine(e.target.value)}
            >
              <option value="">All lines</option>
              {(lines ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Detected</th>
                  <th className="px-4 py-3">Duration</th>
                </tr>
              </thead>
              <tbody>
                {(mismatch.data?.rows ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(r.time).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {r.employee_name} ({r.emp_id})
                    </td>
                    <td className="px-4 py-3">{r.assigned_station}</td>
                    <td className="px-4 py-3">{r.detected_station}</td>
                    <td className="px-4 py-3">{r.duration_seconds ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "quality" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-xs text-slate-600">Date</label>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={qDate}
              onChange={(e) => setQDate(e.target.value)}
            />
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
          </div>

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
                      <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums text-slate-700">{r.operator_id || "—"}</td>
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
                    const T = quality.data?.totals ?? { checked: 0, passed: 0, defect: 0, defect_pct: 0 };
                    let cumC = 0, cumP = 0, cumD = 0;
                    const rows = [
                      { label: "Total Checked / Cum", cls: "text-slate-800", get: (h) => { const v = S[String(h)]?.checked || 0; cumC += v; return v ? `${v}/${cumC}` : "·"; }, total: T.checked },
                      { label: "Total Passed / Cum", cls: "text-emerald-700", get: (h) => { const v = S[String(h)]?.passed || 0; cumP += v; return v ? `${v}/${cumP}` : "·"; }, total: T.passed },
                      { label: "Total Defect / Cum", cls: "text-rose-700", get: (h) => { const v = S[String(h)]?.defect || 0; cumD += v; return v ? `${v}/${cumD}` : "·"; }, total: T.defect },
                      { label: "Repaired → Pass", cls: "text-sky-700", get: (h) => { const v = S[String(h)]?.repaired || 0; return v ? `${v}` : "·"; }, total: T.repaired ?? 0 },
                      { label: "Total Reject", cls: "text-rose-700", get: (h) => { const v = S[String(h)]?.reject || 0; return v ? `${v}` : "·"; }, total: T.reject ?? 0 },
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
              <span>TTL Checked: <b className="text-slate-900">{quality.data?.totals?.checked ?? 0}</b></span>
              <span>TTL Passed: <b className="text-emerald-700">{quality.data?.totals?.passed ?? 0}</b></span>
              <span>TTL Defect: <b className="text-rose-700">{quality.data?.totals?.defect ?? 0}</b></span>
              <span>TTL Reject: <b className="text-rose-700">{quality.data?.totals?.reject ?? 0}</b></span>
              <span>Defect %: <b className="text-amber-700">{quality.data?.totals?.defect_pct ?? 0}%</b></span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
