import ReactECharts from "echarts-for-react";

import { DASH } from "./config";
import { ragForDhu } from "./derive";
import { Card, fmt } from "./ui";

function Kpi({ label, value, suffix, sub, rag, onClick }) {
  return (
    <Card rag={rag} onClick={onClick} className="min-w-0">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-[22px] font-bold leading-tight tabular-nums text-slate-900">
        {value}
        {suffix ? <span className="ml-0.5 text-[12px] font-semibold text-slate-400">{suffix}</span> : null}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{sub}</div> : null}
    </Card>
  );
}

export default function KpiCards({ D, shift, rates, health, scrollTo }) {
  const T = D.totals || {};
  const dhuRag = T.checked > 0 ? ragForDhu(T.dhu_pct) : "grey";
  const idle = (T.station_count || 0) - (T.active_stations || 0);
  const rateRag =
    !shift.isToday || !rates.target
      ? "grey"
      : rates.currentAvgRate >= rates.requiredRate
        ? "green"
        : rates.currentAvgRate >= rates.requiredRate * 0.8
          ? "amber"
          : "red";
  const donut = {
    series: [
      {
        type: "pie",
        radius: ["58%", "88%"],
        center: ["50%", "50%"],
        silent: true,
        label: { show: false },
        data: [
          { value: Math.max(0, (T.passed ?? 0)), itemStyle: { color: "#059669" } },
          { value: Math.max(0, T.defect ?? 0), itemStyle: { color: "#d97706" } },
          { value: Math.max(0, T.reject ?? 0), itemStyle: { color: "#e11d48" } },
        ].filter((d) => d.value > 0),
      },
    ],
  };
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <Kpi label="Achievement" value={`${(T.ach_pct ?? 0).toFixed(1)}%`} sub={`${fmt(T.output)} / ${fmt(T.target)} pcs`} rag={health.achRag} onClick={() => scrollTo("sec-hourly")} />
      <Kpi label="Projected EOD" value={shift.isToday ? fmt(rates.projectedEOD) : fmt(T.output)} suffix="pcs" sub={shift.isToday ? `${rates.projectedPct}% of target` : "day closed"} rag={shift.isToday ? (rates.projectedPct >= 95 ? "green" : rates.projectedPct >= 80 ? "amber" : "red") : "grey"} onClick={() => scrollTo("sec-hourly")} />
      <Kpi label="Required rate" value={shift.isToday ? fmt(rates.requiredRate) : "—"} suffix="/hr" sub={`current avg ${Math.round(rates.currentAvgRate)}/hr`} rag={rateRag} onClick={() => scrollTo("sec-hourly")} />
      <Card rag={dhuRag} onClick={() => scrollTo("sec-quality")} className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">DHU (limit {DASH.DHU_LIMIT}%)</div>
          <div className="text-[22px] font-bold leading-tight tabular-nums text-slate-900">{(T.dhu_pct ?? 0).toFixed(2)}%</div>
          <div className="truncate text-[10.5px] font-semibold text-slate-500">
            chk {fmt(T.checked)} · def {fmt(T.defect)} · pass {fmt(T.passed)}
          </div>
        </div>
        <ReactECharts option={donut} style={{ height: 52, width: 52 }} notMerge />
      </Card>
      <Kpi label="RFT" value={`${(T.rft_pct ?? 0).toFixed(1)}%`} sub={`target ${DASH.RFT_TARGET}%`} rag={(T.rft_pct ?? 0) >= DASH.RFT_TARGET ? "green" : (T.rft_pct ?? 0) >= 85 ? "amber" : "red"} onClick={() => scrollTo("sec-quality")} />
      <Kpi label="Reject" value={`${(T.reject_pct ?? 0).toFixed(2)}%`} sub={`${fmt(T.reject)} pcs`} rag={(T.reject ?? 0) === 0 ? "green" : "red"} onClick={() => scrollTo("sec-quality")} />
      <Kpi label="Active stations" value={`${T.active_stations ?? 0}/${T.station_count ?? 0}`} sub={idle > 0 ? `${idle} idle` : "all active"} rag={idle === 0 ? "green" : idle <= 3 ? "amber" : "red"} onClick={() => scrollTo("sec-machines")} />
      <Kpi label="NPT" value={fmt(D.npt?.total_minutes)} suffix="min" sub={`${D.npt?.events ?? 0} events · ${D.npt?.open_events ?? 0} running`} rag={(D.npt?.open_events || 0) > 0 ? "red" : (D.npt?.total_minutes || 0) > 60 ? "amber" : "green"} onClick={() => scrollTo("sec-npt")} />
    </div>
  );
}
