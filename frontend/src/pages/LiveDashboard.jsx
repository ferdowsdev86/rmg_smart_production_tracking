import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Maximize, Minimize, MonitorPlay } from "lucide-react";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import { CardSkeleton } from "../components/LoadingSkeleton";
import { DASH } from "../components/livedash/config";
import {
  deriveAlerts,
  deriveHealth,
  deriveInsights,
  deriveMachines,
  deriveRates,
  deriveShift,
} from "../components/livedash/derive";
import HealthHero from "../components/livedash/HealthHero";
import KpiCards from "../components/livedash/KpiCards";
import ActionAlerts from "../components/livedash/ActionAlerts";
import HourlyChart from "../components/livedash/HourlyChart";
import MachineHeatmap from "../components/livedash/MachineHeatmap";
import QualityPanel from "../components/livedash/QualityPanel";
import NptPanel from "../components/livedash/NptPanel";
import PerformersPanel from "../components/livedash/PerformersPanel";
import InsightsPanel from "../components/livedash/InsightsPanel";
import ShareMenu from "../components/livedash/ShareMenu";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const VIEWS = [
  { id: "management", label: "Management View" },
  { id: "floor", label: "Floor View" },
  { id: "tv", label: "TV Mode" },
];

export default function LiveDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get("date") || todayISO());
  const [view, setView] = useState(params.get("view") || "management");
  const [clock, setClock] = useState("");
  const [nowTick, setNowTick] = useState(() => new Date());
  const shellRef = useRef(null);
  const chartRef = useRef(null);
  const dataAtRef = useRef(Date.now());
  const [agoS, setAgoS] = useState(0);

  // keep date+view in the URL (shareable link)
  useEffect(() => {
    setParams({ date, view }, { replace: true });
  }, [date, view, setParams]);

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setClock(d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setNowTick(d);
      setAgoS(Math.round((Date.now() - dataAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const { data: D, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ["floor-overview", date],
    queryFn: () => api.get("/automation/floor_overview/", { params: { date } }).then((r) => r.data),
    enabled: !!token,
    refetchInterval: DASH.REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (dataUpdatedAt) dataAtRef.current = dataUpdatedAt;
  }, [dataUpdatedAt]);

  // operator name + operation per machine (existing sewing-lines endpoint)
  const line0 = D?.lines?.[0];
  const opsQ = useQuery({
    queryKey: ["dash-operators", line0?.floor, line0?.line, date],
    queryFn: () =>
      api
        .get(`/automation/sewing-lines/${line0.floor}/${line0.line}/dashboard/`, { params: { date } })
        .then((r) => {
          const map = {};
          for (const s of [...(r.data.machines || []), ...(r.data.input_stations || []), ...(r.data.output_stations || [])]) {
            if (s.machin_no) map[s.machin_no] = { operator_name: s.operator_name !== "—" ? s.operator_name : "", machin_name: s.machin_name || "" };
          }
          return map;
        }),
    enabled: !!token && !!line0,
    staleTime: 60_000,
  });

  // per-machine staff punches: in/out/working hours (multi-operator aware)
  const staffQ = useQuery({
    queryKey: ["dash-staff", date],
    queryFn: () => api.get("/automation/floor_overview_staff/", { params: { date } }).then((r) => r.data),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  // defect-type breakdown (existing drill endpoint)
  const defTypesQ = useQuery({
    queryKey: ["dash-defect-types", date],
    queryFn: () =>
      api.get("/automation/floor_overview_detail/", { params: { kind: "defect", date } }).then((r) => {
        const agg = new Map();
        for (const row of r.data.rows || []) agg.set(row.defect_name, (agg.get(row.defect_name) || 0) + (row.pcs || 0));
        return [...agg.entries()].map(([name, pcs]) => ({ name, pcs })).sort((a, b) => b.pcs - a.pcs);
      }),
    enabled: !!token,
    staleTime: 60_000,
  });

  const derived = useMemo(() => {
    if (!D) return null;
    const isToday = D.date === todayISO();
    const shift = deriveShift(D, nowTick, isToday);
    const rates = deriveRates(D, shift);
    const health = deriveHealth(D, shift, rates, nowTick);
    const mach = deriveMachines(D, shift, rates, opsQ.data || {});
    const alerts = deriveAlerts(D, shift, rates, mach, health);
    const insights = deriveInsights(D, shift, rates, mach);
    return { shift, rates, health, mach, alerts, insights };
    // nowTick minute-level changes matter; second ticks are cheap enough
  }, [D, opsQ.data, Math.floor(nowTick.getTime() / 15000)]); // eslint-disable-line react-hooks/exhaustive-deps

  // TV mode: fullscreen + auto-rotate management ↔ floor focus
  const [tvPane, setTvPane] = useState(0);
  useEffect(() => {
    if (view !== "tv") return undefined;
    const t = setInterval(() => setTvPane((p) => (p + 1) % 2), DASH.TV_ROTATE_SECONDS * 1000);
    return () => clearInterval(t);
  }, [view]);
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  function toggleFull() {
    if (!document.fullscreenElement) shellRef.current?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }

  if (isLoading && !D) {
    return (
      <div className="space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }
  if (isError || !D || !derived) {
    return <div className="rounded-2xl bg-rose-50 p-6 text-sm text-rose-700 ring-1 ring-rose-200">Could not load floor overview.</div>;
  }

  const { shift, rates, health, mach, alerts, insights } = derived;
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const stale = agoS > DASH.STALE_SECONDS;
  const tv = view === "tv";
  const showMgmt = !tv || tvPane === 0;
  const showFloor = view === "floor" || (tv && tvPane === 1);

  return (
    <div ref={shellRef} className={`space-y-3 ${tv ? "bg-white p-3" : ""}`} style={tv && isFull ? { overflow: "auto", height: "100vh" } : undefined}>
      {/* print stylesheet: keep colors, fit management summary on one page */}
      <style>{`@media print {
        @page { size: A4 landscape; margin: 8mm; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        aside, nav, .no-print { display: none !important; }
        #sec-machines { page-break-before: always; }
      }`}</style>

      {/* header */}
      <div className="no-print space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-bold leading-tight text-slate-900 sm:text-lg">
            <span className="sm:hidden">Live Dashboard</span>
            <span className="hidden sm:inline">Live Production &amp; Quality Dashboard</span>
          </h1>
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{line0?.label ? `Line ${line0.label}` : "—"}</span>
          <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-rose-500" : "animate-pulse bg-emerald-500"}`} /> Live · {DASH.REFRESH_MS / 1000}s
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} className={`px-2.5 py-1.5 text-[12px] font-semibold ${view === v.id ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {v.id === "tv" ? (
                  <span className="inline-flex items-center gap-1"><MonitorPlay className="h-3.5 w-3.5" /><span className="hidden sm:inline">{v.label}</span><span className="sm:hidden">TV</span></span>
                ) : (
                  <>
                    <span className="hidden sm:inline">{v.label}</span>
                    <span className="sm:hidden">{v.label.replace(" View", "")}</span>
                  </>
                )}
              </button>
            ))}
          </div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]" />
          <span className="hidden rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-semibold tabular-nums text-slate-700 sm:inline-flex">{clock}</span>
          <ShareMenu D={D} mach={mach} date={date} view={view} chartRef={chartRef} />
          {tv ? (
            <button type="button" onClick={toggleFull} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
              {isFull ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />} {isFull ? "Exit" : "Full screen"}
            </button>
          ) : null}
        </div>
      </div>

      <HealthHero shift={shift} health={health} lastUpdated={agoS} stale={stale} />

      {showMgmt ? (
        <>
          <KpiCards D={D} shift={shift} rates={rates} health={health} scrollTo={scrollTo} />
          <div className="grid gap-3 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <HourlyChart D={D} shift={shift} rates={rates} chartRef={chartRef} />
            </div>
            <ActionAlerts alerts={alerts} />
          </div>
        </>
      ) : null}

      {!tv || tvPane === 1 ? (
        <MachineHeatmap D={D} shift={shift} mach={mach} staff={staffQ.data} compactDefault={tv || view === "floor"} />
      ) : null}

      {showMgmt ? (
        <>
          <QualityPanel D={D} defectTypes={defTypesQ.data} />
          <div className="grid gap-3 xl:grid-cols-3">
            <NptPanel D={D} />
            <PerformersPanel mach={mach} />
            <InsightsPanel insights={insights} />
          </div>
        </>
      ) : null}

      {showFloor && !tv ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <NptPanel D={D} />
          <ActionAlerts alerts={alerts} />
        </div>
      ) : null}

      {/* TODO (data missing from current APIs):
          - per-machine hourly TARGET (falls back to line hour target ÷ running machines)
          - per-machine per-hour defect counts (badge shown at day level)
          - operation/section grouping beyond line_layout.machin_name
          - PNG snapshot of the full page (chart PNG + print are provided) */}
    </div>
  );
}
