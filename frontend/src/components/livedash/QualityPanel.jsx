import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { BRAND_BLUE, DASH } from "./config";
import { ragForDhu } from "./derive";
import { Panel, RagPill, fmt } from "./ui";

const AXIS = {
  axisLine: { lineStyle: { color: "#cbd5e1" } },
  axisTick: { show: false },
  axisLabel: { color: "#64748b", fontSize: 10 },
  splitLine: { lineStyle: { color: "#f1f5f9" } },
};

export default function QualityPanel({ D, defectTypes }) {
  const T = D.totals || {};
  const stations = useMemo(
    () => [...(D.machines || [])].filter((m) => m.scanned > 0 || m.defect > 0).sort((a, b) => b.defect - a.defect),
    [D.machines],
  );

  const pareto = useMemo(() => {
    const top = stations.filter((s) => s.defect > 0);
    const totalDef = top.reduce((a, s) => a + s.defect, 0) || 1;
    let cum = 0;
    const cumPct = top.map((s) => Math.round(((cum += s.defect) / totalDef) * 100));
    return {
      grid: { left: 36, right: 36, top: 24, bottom: 20 },
      tooltip: { trigger: "axis" },
      legend: { top: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 10, color: "#64748b" } },
      xAxis: { type: "category", data: top.map((s) => `M${s.machin_id}`), ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, rotate: 35 } },
      yAxis: [
        { type: "value", ...AXIS },
        { type: "value", max: 100, ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: "{value}%" } },
      ],
      series: [
        {
          name: "Defects",
          type: "bar",
          barMaxWidth: 18,
          data: top.map((s, i) => ({ value: s.defect, itemStyle: { color: i < 5 ? "#d97706" : "#e2e8f0", borderRadius: [3, 3, 0, 0] } })),
        },
        { name: "Cumulative %", type: "line", yAxisIndex: 1, data: cumPct, symbol: "circle", symbolSize: 5, lineStyle: { color: BRAND_BLUE, width: 2 }, itemStyle: { color: BRAND_BLUE } },
      ],
    };
  }, [stations]);

  const gauge = useMemo(() => {
    const dhu = Number(T.dhu_pct || 0);
    const col = dhu <= DASH.DHU_LIMIT ? "#059669" : dhu <= DASH.DHU_AMBER ? "#d97706" : "#e11d48";
    return {
      series: [
        {
          type: "gauge",
          startAngle: 200,
          endAngle: -20,
          min: 0,
          max: 10,
          radius: "100%",
          center: ["50%", "62%"],
          progress: { show: true, width: 10, itemStyle: { color: col } },
          axisLine: { lineStyle: { width: 10, color: [[DASH.DHU_LIMIT / 10, "#d1fae5"], [DASH.DHU_AMBER / 10, "#fef3c7"], [1, "#ffe4e6"]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: true, length: "60%", width: 3, itemStyle: { color: "#334155" } },
          detail: { offsetCenter: [0, "30%"], formatter: `${dhu.toFixed(2)}%`, fontSize: 18, fontWeight: 700, color: "#0f172a" },
          data: [{ value: Math.min(10, dhu) }],
        },
      ],
    };
  }, [T.dhu_pct]);

  const typeBars = useMemo(() => {
    if (!defectTypes?.length) return null;
    const top = defectTypes.slice(0, 7);
    return {
      grid: { left: 4, right: 30, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", ...AXIS, axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: { type: "category", inverse: true, data: top.map((t) => t.name), ...AXIS, axisLabel: { ...AXIS.axisLabel, width: 120, overflow: "truncate" }, splitLine: { show: false } },
      series: [{ type: "bar", data: top.map((t) => t.pcs), barMaxWidth: 12, itemStyle: { color: "#d97706", borderRadius: [0, 3, 3, 0] }, label: { show: true, position: "right", fontSize: 10, color: "#64748b" } }],
    };
  }, [defectTypes]);

  return (
    <Panel
      id="sec-quality"
      title="Quality"
      right={<RagPill rag={T.checked > 0 ? ragForDhu(T.dhu_pct) : "grey"}>DHU {Number(T.dhu_pct || 0).toFixed(2)}% · RFT {Number(T.rft_pct || 0).toFixed(1)}%</RagPill>}
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <div>
          <div className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">DHU vs {DASH.DHU_LIMIT}% target</div>
          <ReactECharts option={gauge} style={{ height: 130 }} notMerge />
          <div className="grid grid-cols-3 gap-1 text-center text-[10.5px]">
            <div className="rounded-md bg-slate-50 py-1"><b>{fmt(T.checked)}</b> <span className="text-slate-400">check</span></div>
            <div className="rounded-md bg-emerald-50 py-1 text-emerald-700"><b>{fmt(T.passed)}</b> <span className="opacity-70">pass</span></div>
            <div className="rounded-md bg-amber-50 py-1 text-amber-700"><b>{fmt(T.defect)}</b> <span className="opacity-70">def</span></div>
          </div>
          {typeBars ? (
            <>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Top defect types</div>
              <ReactECharts option={typeBars} style={{ height: 120 }} notMerge />
            </>
          ) : null}
        </div>
        <div>
          <div className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">Defect pareto by station (top 5 highlighted)</div>
          {stations.some((s) => s.defect > 0) ? (
            <ReactECharts option={pareto} style={{ height: 250 }} notMerge />
          ) : (
            <div className="flex h-[240px] items-center justify-center text-[12px] text-slate-400">No defects recorded.</div>
          )}
        </div>
        <div className="max-h-[280px] overflow-auto rounded-lg ring-1 ring-slate-100">
          <table className="min-w-full text-[11.5px] tabular-nums">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-2 py-1.5 text-left">Station</th><th className="px-2 py-1.5 text-right">Scan</th><th className="px-2 py-1.5 text-right">Def</th><th className="px-2 py-1.5 text-right">Rej</th><th className="px-2 py-1.5 text-left">DHU%</th></tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const rag = ragForDhu(s.dhu_pct);
                const w = Math.min(100, (s.dhu_pct / 10) * 100);
                return (
                  <tr key={s.machin_id} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-bold text-slate-700">M{s.machin_id}</td>
                    <td className="px-2 py-1 text-right text-slate-500">{fmt(s.scanned)}</td>
                    <td className={`px-2 py-1 text-right font-bold ${s.defect ? "text-amber-700" : "text-slate-300"}`}>{s.defect}</td>
                    <td className={`px-2 py-1 text-right ${s.reject ? "text-rose-700" : "text-slate-300"}`}>{s.reject}</td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-12 overflow-hidden rounded bg-slate-100"><span className="block h-full" style={{ width: `${w}%`, background: rag === "green" ? "#059669" : rag === "amber" ? "#d97706" : "#e11d48" }} /></span>
                        <b className={rag === "green" ? "text-emerald-700" : rag === "amber" ? "text-amber-700" : "text-rose-700"}>{s.dhu_pct}%</b>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
