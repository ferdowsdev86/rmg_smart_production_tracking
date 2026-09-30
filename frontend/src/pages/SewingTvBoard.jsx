import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { CheckCircle2, Maximize, Minimize, PauseCircle } from "lucide-react";

import { CardSkeleton } from "../components/LoadingSkeleton";
import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import { useSewingBoardSocket } from "../hooks/useSewingBoardSocket";

/* Industrial TV board palette (matches the reference display) */
const TV = {
  page: "#06182e",
  panel: "#0a2240",
  border: "#1d3f6e",
  label: "#8fb3d9",
  green: "#22c55e",
  red: "#ff4d4f",
  yellow: "#fbbf24",
  blue: "#38bdf8",
};

/* neon glow for big accent numbers (3D depth feel) */
const glow = (c) => ({ color: c, textShadow: `0 0 10px ${c}59, 0 0 26px ${c}33` });

const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
/* local (factory) calendar date — not UTC, so the board flips at local midnight */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/* minutes → HH:MM:SS display like the reference board */
function minsToClock(min) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
}

const DESIGN_W = 1560;

function Panel({ title, children, className = "" }) {
  return (
    <div
      className={`relative flex min-h-0 flex-col rounded-xl border p-3 transition-all duration-300 hover:-translate-y-1 hover:scale-[1.015] ${className}`}
      style={{
        background: "linear-gradient(160deg, #103159 0%, #0a2240 48%, #071a33 100%)",
        borderColor: TV.border,
        boxShadow:
          "0 14px 30px rgba(0,0,0,0.55), 0 3px 8px rgba(0,0,0,0.45), inset 0 1px 0 rgba(120,180,255,0.10)",
      }}
    >
      {/* top light edge — gives the card a raised 3D lip */}
      <div
        className="pointer-events-none absolute inset-x-3 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(56,189,248,0.55), transparent)" }}
      />
      <div className="mb-1.5 text-[13px] font-extrabold uppercase tracking-widest text-white">
        {title}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function StatLabel({ children }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TV.label }}>
      {children}
    </div>
  );
}

export default function SewingTvBoard() {
  const token = useAuthStore((s) => s.accessToken);
  const shellRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, designH: 860, height: null });
  const [clock, setClock] = useState("");
  const [isFull, setIsFull] = useState(false);

  function toggleFull() {
    if (!document.fullscreenElement) {
      shellRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    function refit() {
      const el = shellRef.current;
      if (!el) return;
      const availW = el.clientWidth || DESIGN_W;
      const top = el.getBoundingClientRect().top;
      const availH = Math.max(480, window.innerHeight - top);
      const scale = availW / DESIGN_W;
      const designH = Math.max(560, availH / scale);
      setFit((p) =>
        p.scale !== scale || p.designH !== designH || p.height !== availH
          ? { scale, designH, height: availH }
          : p,
      );
    }
    refit();
    window.addEventListener("resize", refit);
    document.addEventListener("fullscreenchange", refit);
    const t = setInterval(refit, 1500);
    return () => {
      window.removeEventListener("resize", refit);
      document.removeEventListener("fullscreenchange", refit);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setClock(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // optional ?date=YYYY-MM-DD to review a past day on the board
  const qdate = new URLSearchParams(window.location.search).get("date") || todayISO();
  const isLiveDay = qdate === todayISO();

  // Instant refresh when quality pass / barcode production / scans land.
  useSewingBoardSocket(!!token && isLiveDay);

  const { data: D, isLoading, isError } = useQuery({
    queryKey: ["sewing-tv", qdate],
    queryFn: () =>
      api.get("/automation/floor_overview/", { params: { date: qdate } }).then((r) => r.data),
    enabled: !!token,
    refetchInterval: isLiveDay ? 3000 : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
  });

  const view = useMemo(() => {
    if (!D) return null;
    const T = D.totals;
    const alerts = [];
    for (const l of D.lines || []) {
      if (l.target_qty && l.ach_pct < 75) alerts.push({ lvl: "red", text: `Line ${l.label} achievement ${l.ach_pct}% — critical` });
      else if (l.target_qty && l.ach_pct < 90) alerts.push({ lvl: "yellow", text: `Line ${l.label} achievement ${l.ach_pct}% behind` });
      if (l.dhu_pct > 3) alerts.push({ lvl: "red", text: `Line ${l.label} DHU ${l.dhu_pct}% above 3%` });
      if (l.station_count && l.active_stations < l.station_count)
        alerts.push({ lvl: "yellow", text: `${l.station_count - l.active_stations} station idle on ${l.label}` });
    }
    if (D.npt?.total_minutes > 60) alerts.push({ lvl: "red", text: `Total NPT ${D.npt.total_minutes} min today` });
    if (!alerts.length) alerts.push({ lvl: "green", text: "No critical production or quality issue" });
    const running = (T.active_stations || 0) > 0;
    const hasRed = alerts.some((a) => a.lvl === "red");
    const lineNames = (D.lines || []).map((l) => l.label).join(", ");
    const balance = Math.max(0, (T.target || 0) - (T.output || 0));
    const utilization = T.station_count ? (T.active_stations / T.station_count) * 100 : 0;
    const nptCats = D.npt?.categories || [];
    const topNpt = nptCats.length ? Math.max(...nptCats.map((c) => c.minutes || 0)) : 0;
    return { T, alerts: alerts.slice(0, 5), running, hasRed, lineNames, balance, utilization, nptCats, topNpt };
  }, [D]);

  // Hourly target-vs-achieve matrix (shared by the table and the chart)
  const matrix = useMemo(() => {
    if (!D) return null;
    const hrs = D.hourly || [];
    const T = D.totals;
    const isToday = D.date === todayISO();
    const nowH = new Date().getHours();
    const totalHours = hrs.filter((h) => !h.overtime).length || hrs.length;
    const perHour = hrs.length ? hrs[0].target : 0;
    let cumT = 0;
    let cumA = 0;
    const rows = hrs.map((h) => {
      const state = !isToday ? "past" : h.hour < nowH ? "past" : h.hour === nowH ? "now" : "future";
      cumT += h.target;
      const act = state === "future" ? null : h.actual;
      if (act != null) cumA += act;
      const pct = state === "future" || !h.target ? null : (h.actual / h.target) * 100;
      return { ...h, state, act, cumT, cumA: state === "future" ? null : cumA, pct, variance: act == null ? null : act - h.target };
    });
    const achievedSoFar = cumA;
    const elapsedTarget = rows.filter((r) => r.state !== "future").reduce((a, r) => a + r.target, 0);
    const dayPct = T.target ? (achievedSoFar / T.target) * 100 : 0;
    return { rows, totalHours, perHour, achievedSoFar, elapsedTarget, dayPct };
  }, [D]);

  // 3D-glass style chart from the matrix: glassy target bars, violet achieve
  // bars, bold white cumulative-achieve trend line ending in an arrow.
  const matrixChartOpt = useMemo(() => {
    if (!matrix) return {};
    const rows = matrix.rows;
    const lastIdx = (() => { let i = -1; rows.forEach((r, k) => { if (r.cumA != null) i = k; }); return i; })();
    const ax = {
      axisLine: { lineStyle: { color: "#2a4f7c" } },
      axisTick: { show: false },
      axisLabel: { color: "#9dbce0", fontSize: 12, fontWeight: 600 },
      splitLine: { lineStyle: { color: "rgba(56,189,248,0.10)" } },
    };
    const glass = (c1, c2) => ({
      type: "linear", x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }],
    });
    return {
      backgroundColor: "transparent",
      grid: { left: 48, right: 56, top: 38, bottom: 30 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, left: 48, itemWidth: 14, itemHeight: 9, textStyle: { fontSize: 11, color: TV.label } },
      xAxis: { type: "category", data: rows.map((r) => r.label), ...ax, splitLine: { show: false } },
      yAxis: [
        { type: "value", name: "pcs / hr", nameTextStyle: { color: TV.label, fontSize: 10 }, ...ax },
        { type: "value", name: "cumulative", nameTextStyle: { color: TV.label, fontSize: 10 }, ...ax, splitLine: { show: false } },
      ],
      series: [
        {
          name: "Target / hr", type: "bar", data: rows.map((r) => r.target), barMaxWidth: 22, barGap: "10%",
          itemStyle: { color: glass("rgba(125,211,252,0.75)", "rgba(56,189,248,0.18)"), borderColor: "rgba(186,230,253,0.9)", borderWidth: 1, borderRadius: [4, 4, 0, 0], shadowColor: "rgba(56,189,248,0.45)", shadowBlur: 14 },
        },
        {
          name: "Achieve / hr", type: "bar", data: rows.map((r) => r.act), barMaxWidth: 22,
          itemStyle: { color: glass("rgba(196,181,253,0.95)", "rgba(124,58,237,0.55)"), borderColor: "rgba(221,214,254,0.9)", borderWidth: 1, borderRadius: [4, 4, 0, 0], shadowColor: "rgba(167,139,250,0.6)", shadowBlur: 16 },
          label: { show: true, position: "top", color: "#e9d5ff", fontSize: 11, fontWeight: 700, formatter: (p) => (p.value == null ? "" : p.value) },
        },
        {
          name: "Cum target", type: "line", yAxisIndex: 1, data: rows.map((r) => r.cumT), symbol: "none",
          lineStyle: { color: "rgba(125,211,252,0.55)", width: 2, type: "dashed" },
        },
        {
          name: "Cum achieve", type: "line", yAxisIndex: 1, data: rows.map((r) => r.cumA), smooth: 0.15,
          symbol: "circle", symbolSize: 7, itemStyle: { color: "#ffffff", borderColor: "#ffffff" },
          lineStyle: { color: "#ffffff", width: 4, shadowColor: "rgba(255,255,255,0.55)", shadowBlur: 14 },
          endLabel: { show: true, color: "#ffffff", fontSize: 13, fontWeight: 800, formatter: (p) => (p.value == null ? "" : `${fmt(p.value)} pcs`) },
          markPoint: lastIdx >= 0 ? {
            symbol: "arrow", symbolSize: [26, 30], symbolRotate: 35,
            itemStyle: { color: "#ffffff", shadowColor: "rgba(255,255,255,0.6)", shadowBlur: 12 },
            label: { show: false },
            data: [{ coord: [rows[lastIdx].label, rows[lastIdx].cumA] }],
          } : undefined,
        },
      ],
      // floating glass cubes for the 3D feel (decorative)
      graphic: [
        { type: "rect", left: "18%", top: "12%", shape: { width: 14, height: 14, r: 3 }, rotation: 0.6, style: { fill: "rgba(56,189,248,0.28)", stroke: "rgba(186,230,253,0.7)", lineWidth: 1 }, silent: true },
        { type: "rect", left: "62%", top: "9%", shape: { width: 11, height: 11, r: 2 }, rotation: 0.9, style: { fill: "rgba(167,139,250,0.30)", stroke: "rgba(221,214,254,0.7)", lineWidth: 1 }, silent: true },
        { type: "rect", left: "84%", top: "20%", shape: { width: 9, height: 9, r: 2 }, rotation: 0.4, style: { fill: "rgba(56,189,248,0.25)", stroke: "rgba(186,230,253,0.6)", lineWidth: 1 }, silent: true },
        { type: "rect", left: "40%", top: "25%", shape: { width: 8, height: 8, r: 2 }, rotation: 1.1, style: { fill: "rgba(167,139,250,0.25)", stroke: "rgba(221,214,254,0.6)", lineWidth: 1 }, silent: true },
      ],
    };
  }, [matrix]);

  // 3D-look donut: achieved vs balance of the day target
  const prodDonutOpt = useMemo(() => {
    if (!D) return {};
    const T = D.totals;
    const target = Math.max(0, T.target || 0);
    const done = Math.min(target || T.output || 0, Math.max(0, T.output || 0));
    const balance = Math.max(0, target - done);
    const pct = target ? (done / target) * 100 : 0;
    const col = pct >= 90 ? TV.green : pct >= 75 ? TV.yellow : TV.red;
    const ring = (c1, c2) => ({ type: "radial", x: 0.5, y: 0.5, r: 0.75, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} pcs ({d}%)" },
      series: [
        // shadow/base ring underneath for depth
        {
          type: "pie", radius: ["52%", "84%"], center: ["50%", "54%"], silent: true, label: { show: false },
          data: [{ value: 1, itemStyle: { color: "rgba(0,0,0,0.45)", shadowColor: "rgba(0,0,0,0.7)", shadowBlur: 24, shadowOffsetY: 10 } }],
        },
        {
          type: "pie", radius: ["50%", "80%"], center: ["50%", "50%"], avoidLabelOverlap: false,
          itemStyle: { borderColor: "#071a33", borderWidth: 3 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          data: [
            { name: "Achieved", value: done, itemStyle: { color: ring("#86efac", col), shadowColor: col, shadowBlur: 18 } },
            { name: "Balance", value: balance || (done ? 0 : 1), itemStyle: { color: ring("rgba(56,120,190,0.55)", "rgba(18,49,79,0.9)") } },
          ],
        },
      ],
      graphic: [
        { type: "text", left: "center", top: "40%", style: { text: `${pct.toFixed(1)}%`, fontSize: 24, fontWeight: 800, fill: "#ffffff", shadowColor: col, shadowBlur: 12 } },
        { type: "text", left: "center", top: "56%", style: { text: "ACHIEVED", fontSize: 9, fontWeight: 700, fill: TV.label } },
      ],
    };
  }, [D]);

  // Realtime SMV-based line efficiency:
  // earned (output × SMV) / available (manpower × worked minutes) × 100
  const gaugeOpt = useMemo(() => {
    if (!D) return {};
    const p = D.efficiency?.pct ?? 0;
    const col = p >= 60 ? TV.green : p >= 40 ? TV.yellow : TV.red;
    return {
      series: [
        {
          type: "gauge",
          startAngle: 195,
          endAngle: -15,
          min: 0,
          max: 120,
          radius: "97%",
          center: ["50%", "68%"],
          progress: {
            show: true,
            width: 16,
            itemStyle: { color: col, shadowColor: col, shadowBlur: 16 },
          },
          axisLine: { lineStyle: { width: 16, color: [[1, "#12314f"]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, "-18%"],
            formatter: (v) => `{v|${v.toFixed(1)}%}\n{l|LINE EFFICIENCY}`,
            rich: {
              v: { fontSize: 27, fontWeight: 700, color: "#ffffff" },
              l: { fontSize: 9, fontWeight: 700, color: TV.label, letterSpacing: 1.5, padding: [5, 0, 0, 0] },
            },
          },
          data: [{ value: Math.min(120, p) }],
        },
      ],
    };
  }, [D]);

  if (isLoading && !D) {
    return (
      <div className="space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }
  if (isError || !D || !view) {
    return <div className="rounded-2xl bg-rose-50 p-6 text-sm text-rose-700 ring-1 ring-rose-200">Could not load sewing line overview.</div>;
  }

  const { T, alerts, running, hasRed, lineNames, balance, utilization, nptCats, topNpt } = view;
  const achPct = T.target ? Math.min(100, (T.output / T.target) * 100) : 0;
  const nptShare = (m) => (D.npt?.total_minutes ? Math.round((m / D.npt.total_minutes) * 100) : 0);
  // hour columns for the station-wise hourly pass matrix
  const stationHours = (() => {
    const hs = new Set();
    for (const m of D.machine_hours || []) for (const k of Object.keys(m.by_hour || {})) hs.add(Number(k));
    const arr = [...hs].sort((a, b) => a - b);
    return arr.length ? arr.slice(0, 12) : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  })();

  return (
    <div
      ref={shellRef}
      className="-m-4"
      style={{
        height: fit.height ?? undefined,
        overflow: "hidden",
        background:
          "radial-gradient(1300px 640px at 50% -12%, #103564 0%, #06182e 55%, #030e1f 100%)",
      }}
    >
      <div
        className="flex flex-col gap-2.5 p-3"
        style={{ width: DESIGN_W, height: fit.designH, transform: `scale(${fit.scale})`, transformOrigin: "top left" }}
      >
        {/* ============ header ============ */}
        <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: TV.border }}>
          <div className="flex items-center gap-4">
            <div className="text-[22px] font-extrabold uppercase tracking-wide text-white">
              Sewing Line {lineNames || "—"} <span className="mx-2 font-light" style={{ color: TV.label }}>|</span> Live Dashboard
            </div>
            {/* line status inline in the top bar */}
            <span
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1"
              style={{ borderColor: TV.border, background: "#0d2a4d" }}
            >
              {running ? (
                <CheckCircle2 className="h-5 w-5" style={{ color: TV.green }} />
              ) : (
                <PauseCircle className="h-5 w-5" style={{ color: TV.yellow }} />
              )}
              <b className="text-[14px] uppercase tracking-wide" style={{ color: running ? TV.green : TV.yellow }}>
                {running ? "Running" : "Idle"}
              </b>
              <span className="text-[12px] font-semibold" style={{ color: TV.label }}>
                Stations {T.active_stations}/{T.station_count}
              </span>
              <span className="text-[12px] font-bold" style={{ color: hasRed ? TV.red : TV.green }}>
                {hasRed ? "Attention Needed" : "All Systems Normal"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[20px] font-bold tabular-nums text-white">{clock || "—"}</span>
            <button
              type="button"
              onClick={toggleFull}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[13px] font-bold text-white transition hover:brightness-125"
              style={{ borderColor: TV.border, background: "#0d2a4d" }}
            >
              {isFull ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              {isFull ? "Exit" : "Full Screen"}
            </button>
            <span
              className="animate-pulse rounded-md px-3 py-1 text-[13px] font-extrabold uppercase text-white"
              style={{ background: TV.green, boxShadow: `0 0 14px ${TV.green}80` }}
            >
              Live
            </span>
          </div>
        </div>

        {/* ============ row 1 ============ */}
        <div className="grid min-h-0 flex-[44] grid-cols-12 gap-2.5">
          <Panel title="Production (Today)" className="col-span-3">
            <div className="flex h-full min-h-0 flex-col">
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div>
                <StatLabel>Target</StatLabel>
                <div className="text-[30px] font-bold leading-tight text-white tabular-nums">{fmt(T.target)}</div>
              </div>
              <div>
                <StatLabel>Actual</StatLabel>
                <div className="text-[30px] font-bold leading-tight tabular-nums" style={glow(TV.green)}>{fmt(T.output)}</div>
              </div>
              <div>
                <StatLabel>Balance</StatLabel>
                <div className="text-[30px] font-bold leading-tight text-white tabular-nums">{fmt(balance)}</div>
              </div>
            </div>
            <div className="mt-5">
              <div className="h-3 overflow-hidden rounded" style={{ background: "#0b2444", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)" }}>
                <div
                  className="h-full rounded transition-all duration-700"
                  style={{
                    width: `${achPct}%`,
                    background: `linear-gradient(180deg, #4ade80, ${TV.green})`,
                    boxShadow: `0 0 12px ${TV.green}99`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] font-semibold" style={{ color: TV.label }}>
                <span>0</span>
                <span>{achPct.toFixed(0)}%</span>
                <span>{fmt(T.target)}</span>
              </div>
            </div>
            {/* 3D donut: achieved vs balance */}
            <div className="min-h-0 flex-1">
              <ReactECharts option={prodDonutOpt} style={{ height: "100%", minHeight: 120 }} notMerge />
            </div>
            <div className="flex justify-center gap-4 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TV.green }} />Achieved {fmt(T.output)}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#2f5f92" }} />Balance {fmt(balance)}</span>
            </div>
            </div>
          </Panel>

          <Panel title="Efficiency" className="col-span-3">
            <div className="flex h-full flex-col">
              {/* gauge on top — short & wide so the arc stays fully visible */}
              <div className="min-h-0 flex-1" style={{ maxHeight: 170 }}>
                <ReactECharts option={gaugeOpt} style={{ height: "100%", minHeight: 130 }} notMerge />
              </div>
              {/* calculation transparency: smv / earned / available / manpower */}
              <div className="pb-1 text-center text-[10.5px] font-semibold" style={{ color: TV.label }}>
                SMV {D.efficiency?.smv ?? 0} · Earned {fmt(D.efficiency?.earned_min)}m / Avail {fmt(D.efficiency?.avail_min)}m · MP {D.efficiency?.manpower ?? 0}
              </div>
              {/* stat strip below */}
              <div className="grid grid-cols-3 gap-2 pt-2">
                {[
                  { k: "Achieve", v: `${T.ach_pct.toFixed(1)}%`, good: T.ach_pct >= 90 },
                  { k: "RFT", v: `${T.rft_pct.toFixed(1)}%`, good: T.rft_pct >= 95 },
                  { k: "Stations", v: `${(utilization).toFixed(0)}%`, good: utilization >= 80 },
                ].map((r) => (
                  <div key={r.k} className="rounded px-2 py-1.5 text-center" style={{ background: "#0d2a4d" }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TV.label }}>{r.k}</div>
                    <b className="text-[18px] tabular-nums" style={{ color: r.good ? TV.green : TV.yellow }}>{r.v}</b>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Quality" className="col-span-2">
            <div className="flex h-full flex-col items-center justify-between py-1 text-center">
              <div>
                <StatLabel>Defects</StatLabel>
                <div className="text-[30px] font-bold leading-tight text-white tabular-nums">{fmt(T.defect)}</div>
              </div>
              <div>
                <StatLabel>DHU</StatLabel>
                <div className="text-[26px] font-bold leading-tight tabular-nums" style={glow(T.dhu_pct <= 3 ? TV.green : TV.red)}>
                  {T.dhu_pct.toFixed(2)}%
                </div>
              </div>
              <div>
                <StatLabel>Rejects</StatLabel>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: T.reject > 0 ? TV.red : TV.green }}>
                  {fmt(T.reject)} · {T.reject_pct.toFixed(2)}%
                </div>
              </div>
              {/* bottom line: total check / total pass — raised 3D chips */}
              <div className="grid w-full grid-cols-2 gap-2 pt-1">
                {[
                  { k: "T. Check", v: T.checked, c: TV.blue },
                  { k: "T. Pass", v: T.passed ?? 0, c: TV.green },
                ].map((x) => (
                  <div
                    key={x.k}
                    className="rounded-lg px-2 py-1.5"
                    style={{
                      background: "linear-gradient(180deg, #14365f 0%, #0b2444 100%)",
                      boxShadow: `0 8px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 12px ${x.c}33`,
                      border: `1px solid ${x.c}55`,
                    }}
                  >
                    <div className="text-[9px] font-extrabold uppercase tracking-wider" style={{ color: TV.label }}>{x.k}</div>
                    <div className="text-[18px] font-bold leading-tight tabular-nums" style={glow(x.c)}>{fmt(x.v)}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="NPT (Today)" className="col-span-2">
            <div className="flex h-full flex-col items-center justify-between py-1 text-center">
              <div className="text-[34px] font-extrabold tabular-nums leading-tight" style={glow((D.npt?.total_minutes || 0) > 0 ? TV.red : TV.green)}>
                {minsToClock(D.npt?.total_minutes)}
              </div>
              <div>
                <StatLabel>NPT Events</StatLabel>
                <div className="text-[24px] font-bold text-white tabular-nums">{nptCats.length}</div>
              </div>
              <div>
                <StatLabel>Longest NPT</StatLabel>
                <div className="text-[20px] font-bold tabular-nums" style={{ color: TV.yellow }}>{minsToClock(topNpt)}</div>
              </div>
            </div>
          </Panel>

          <Panel title="Alerts" className="col-span-2">
            <div className="flex h-full flex-col justify-center">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 border-b py-2" style={{ borderColor: "#123055" }}>
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full ${a.lvl === "red" ? "animate-pulse" : ""}`}
                    style={{
                      background: a.lvl === "red" ? TV.red : a.lvl === "yellow" ? TV.yellow : TV.green,
                      boxShadow: `0 0 8px ${a.lvl === "red" ? TV.red : a.lvl === "yellow" ? TV.yellow : TV.green}99`,
                    }}
                  />
                  <span className="text-[12px] font-semibold leading-snug text-white">{a.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ============ row 2 ============ */}
        <div className="grid min-h-0 flex-[56] grid-cols-12 gap-2.5">
          <Panel title="Target vs Achieve — Hourly Trend" className="col-span-5">
            {matrix ? (() => {
              const { totalHours, perHour, achievedSoFar, elapsedTarget, dayPct } = matrix;
              const tone = (p) => (p == null ? TV.label : p >= 100 ? TV.green : p >= 80 ? TV.yellow : TV.red);
              return (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="mb-1 flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span className="rounded px-2 py-0.5" style={{ background: "#0d2a4d", color: TV.blue }}>Day target {fmt(T.target)} pcs</span>
                    <span className="rounded px-2 py-0.5" style={{ background: "#0d2a4d", color: TV.label }}>{totalHours} hrs · {fmt(perHour)} pcs/hr</span>
                    <span className="rounded px-2 py-0.5" style={{ background: "#0d2a4d", color: tone(dayPct) }}>Achieved {fmt(achievedSoFar)} · {dayPct.toFixed(1)}%</span>
                    <span className="rounded px-2 py-0.5" style={{ background: "#0d2a4d", color: achievedSoFar - elapsedTarget >= 0 ? TV.green : TV.red }}>
                      vs elapsed target {achievedSoFar - elapsedTarget >= 0 ? "+" : ""}{fmt(achievedSoFar - elapsedTarget)}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1">
                    <ReactECharts option={matrixChartOpt} style={{ height: "100%", minHeight: 200 }} notMerge />
                  </div>
                </div>
              );
            })() : null}
          </Panel>

          <Panel title="Station Hourly Pass" className="col-span-4">
            {(D.machine_hours || []).length ? (
              <div className="h-full overflow-auto">
                <table className="min-w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] font-bold uppercase tracking-wider" style={{ color: TV.label }}>
                      <th className="border-b py-1.5 text-left" style={{ borderColor: TV.border }}>Station</th>
                      {stationHours.map((h) => (
                        <th key={h} className="border-b py-1.5 text-right" style={{ borderColor: TV.border }}>
                          {String(h).padStart(2, "0")}h
                        </th>
                      ))}
                      <th className="border-b py-1.5 text-right" style={{ borderColor: TV.border, color: TV.green }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(D.machine_hours || []).map((m) => (
                      <tr key={m.machin_id}>
                        <td className="border-b py-2 font-bold text-white" style={{ borderColor: "#123055" }}>M{m.machin_id}</td>
                        {stationHours.map((h) => {
                          const v = m.by_hour?.[String(h)] || 0;
                          return (
                            <td key={h} className="border-b py-2 text-right tabular-nums" style={{ borderColor: "#123055", color: v ? "#ffffff" : "#3d5a80" }}>
                              {v || "—"}
                            </td>
                          );
                        })}
                        <td className="border-b py-2 text-right font-bold tabular-nums" style={{ borderColor: "#123055", color: TV.green }}>
                          {fmt(m.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[14px] font-semibold" style={{ color: TV.label }}>
                No station output yet
              </div>
            )}
          </Panel>

          <Panel title="Top NPT Reasons" className="col-span-3">
            {nptCats.length ? (
              <table className="min-w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: TV.label }}>
                    <th className="border-b py-1.5" style={{ borderColor: TV.border }}>Reason</th>
                    <th className="border-b py-1.5 text-right" style={{ borderColor: TV.border }}>Duration</th>
                    <th className="border-b py-1.5 text-right" style={{ borderColor: TV.border }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {nptCats.slice(0, 6).map((c) => (
                    <tr key={c.category}>
                      <td className="border-b py-2 font-semibold text-white" style={{ borderColor: "#123055" }}>{c.category}</td>
                      <td className="border-b py-2 text-right font-bold tabular-nums" style={{ borderColor: "#123055", color: TV.yellow }}>
                        {minsToClock(c.minutes)}
                      </td>
                      <td className="border-b py-2 text-right tabular-nums" style={{ borderColor: "#123055", color: TV.label }}>
                        {nptShare(c.minutes)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center text-[15px] font-bold" style={{ color: TV.green }}>
                ✓ No NPT today
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
