import { useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";

import { BRAND_BLUE } from "./config";
import { Panel } from "./ui";

const AXIS = {
  axisLine: { lineStyle: { color: "#cbd5e1" } },
  axisTick: { show: false },
  axisLabel: { color: "#64748b", fontSize: 10.5 },
  splitLine: { lineStyle: { color: "#f1f5f9" } },
};

export default function HourlyChart({ D, shift, rates, chartRef }) {
  const option = useMemo(() => {
    const hrs = D.hourly || [];
    const nowH = shift.nowH;
    const nowMin = new Date().getMinutes();
    let ct = 0;
    let ca = 0;
    const cumT = hrs.map((s) => (ct += s.target || 0));
    const cumA = hrs.map((s) => (!shift.isToday || s.hour <= nowH ? (ca += s.actual || 0) : null));
    const gap = hrs.map((s, i) => (cumA[i] == null ? null : Math.max(0, cumT[i] - cumA[i])));
    // dashed projection from the current hour onward
    const proj = hrs.map((s, i) => {
      if (!shift.isToday) return null;
      if (s.hour < nowH) return null;
      const hoursAhead = s.hour - nowH + 1;
      return Math.round(rates.output + rates.currentAvgRate * hoursAhead);
    });
    const bars = hrs.map((s) => {
      const tgt = s.target || 0;
      const v = s.actual || 0;
      const pct = tgt ? (v / tgt) * 100 : 100;
      const state = !shift.isToday || s.hour < nowH ? "past" : s.hour === nowH ? "now" : "future";
      let color = pct >= 100 ? "#059669" : pct >= 80 ? "#84cc16" : pct >= 50 ? "#d97706" : "#e11d48";
      if (state === "future") color = "#e2e8f0";
      const item = { value: state === "future" ? 0 : v, itemStyle: { color, borderRadius: [3, 3, 0, 0] } };
      if (state === "now")
        item.itemStyle = {
          ...item.itemStyle,
          decal: { symbol: "line", rotation: Math.PI / 4, color: "rgba(255,255,255,0.55)", dashArrayX: [1, 0], dashArrayY: [3, 3] },
          borderColor: BRAND_BLUE,
          borderWidth: 1.5,
        };
      return item;
    });
    return {
      grid: { left: 44, right: 46, top: 28, bottom: 22 },
      tooltip: {
        trigger: "axis",
        formatter: (ps) => {
          const i = ps[0]?.dataIndex ?? 0;
          const s = hrs[i];
          if (!s) return "";
          const pct = s.target ? Math.round(((s.actual || 0) / s.target) * 100) : 0;
          const state = shift.isToday && s.hour === nowH ? ` · in progress (${nowMin} min)` : "";
          return `<b>${s.label}</b>${state}<br/>achieved ${s.actual || 0} / target ${s.target || 0} (${pct}%)<br/>cum ${cumA[i] ?? "—"} vs ${cumT[i]}`;
        },
      },
      legend: { top: 0, left: 44, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 10.5, color: "#64748b" }, data: ["Hourly achieve", "Cum target", "Cum achieve", "Projection"] },
      xAxis: { type: "category", data: hrs.map((s) => s.label), ...AXIS, splitLine: { show: false } },
      yAxis: [
        { type: "value", name: "pcs/hr", nameTextStyle: { color: "#94a3b8", fontSize: 9 }, ...AXIS },
        { type: "value", name: "cumulative", nameTextStyle: { color: "#94a3b8", fontSize: 9 }, ...AXIS, splitLine: { show: false } },
      ],
      series: [
        { name: "Hourly achieve", type: "bar", data: bars, barMaxWidth: 20 },
        { name: "Cum target", type: "line", yAxisIndex: 1, data: cumT, symbol: "none", lineStyle: { color: "#64748b", width: 1.5, type: "dashed" } },
        // gap shading: stack base (cumA, invisible) + red band up to cumT
        { name: "_base", type: "line", yAxisIndex: 1, data: cumA, stack: "gap", symbol: "none", lineStyle: { width: 0 }, silent: true, tooltip: { show: false } },
        { name: "Gap", type: "line", yAxisIndex: 1, data: gap, stack: "gap", symbol: "none", lineStyle: { width: 0 }, areaStyle: { color: "rgba(225,29,72,0.12)" }, silent: true },
        { name: "Cum achieve", type: "line", yAxisIndex: 1, data: cumA, symbol: "circle", symbolSize: 5, lineStyle: { color: BRAND_BLUE, width: 2.5 }, itemStyle: { color: BRAND_BLUE } },
        { name: "Projection", type: "line", yAxisIndex: 1, data: proj, symbol: "none", lineStyle: { color: "#94a3b8", width: 2, type: [2, 4] } },
      ],
    };
  }, [D, shift, rates]);

  return (
    <Panel id="sec-hourly" className="h-full" title="Hourly Target vs Achieve" right={
      <span className="text-[11px] font-semibold text-slate-400">
        hour target {rates.hourTarget} · avg {Math.round(rates.currentAvgRate)}/hr
      </span>
    }>
      <ReactECharts ref={chartRef} option={option} style={{ height: 320 }} notMerge />
    </Panel>
  );
}
