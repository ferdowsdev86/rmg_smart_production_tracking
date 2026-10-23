import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Minus, Search, X } from "lucide-react";

import { DASH } from "./config";
import { hhmm, minutesSince } from "./derive";
import { Panel, Spark, STATUS_PILL, fmt } from "./ui";

/* cell background by % of this machine's hourly target */
function cellStyle(v, target, state, lineRunning) {
  if (state === "future") return { background: "#fff", color: "#cbd5e1" };
  if (v === 0) {
    if (!lineRunning) return { background: "#f8fafc", color: "#cbd5e1" };
    return { background: "#fecdd3", color: "#9f1239", fontWeight: 700 };
  }
  if (!target) return { background: "#eff6ff", color: "#1e3a8a" };
  const pct = (v / target) * 100;
  if (pct >= DASH.CELL_GREEN) return { background: "#059669", color: "#fff", fontWeight: 700 };
  if (pct >= DASH.CELL_LIGHT) return { background: "#bbf7d0", color: "#065f46", fontWeight: 600 };
  if (pct >= DASH.CELL_AMBER) return { background: "#fde68a", color: "#92400e", fontWeight: 600 };
  return { background: "#fca5a5", color: "#7f1d1d", fontWeight: 600 };
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "slow", label: "Below target" },
  { id: "idle", label: "Idle now" },
  { id: "down", label: "Down (NPT)" },
  { id: "notstarted", label: "Not started" },
  { id: "defects", label: "Has defects" },
];

export default function MachineHeatmap({ D, shift, mach, staff, compactDefault = false }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("total");
  const [compact, setCompact] = useState(compactDefault);
  const [showFuture, setShowFuture] = useState(false);
  const [showNoPunch, setShowNoPunch] = useState(false);
  const [drawer, setDrawer] = useState(null); // {machine, hour?}

  // only machines where someone punched today are listed; the rest stay
  // behind the "no punch" toggle (all machines remain in the data)
  const staffMap = staff?.machines || null;
  const noPunchCount = useMemo(
    () => (staffMap ? mach.machines.filter((m) => !staffMap[String(m.mid)]).length : 0),
    [mach.machines, staffMap]
  );
  const baseMachines = useMemo(
    () => (staffMap && !showNoPunch ? mach.machines.filter((m) => staffMap[String(m.mid)]) : mach.machines),
    [mach.machines, staffMap, showNoPunch]
  );

  const hours = (D.hourly || []).map((s) => ({ hour: s.hour, label: s.label }));
  const nowH = shift.nowH;
  const hourState = (h) => (!shift.isToday ? "past" : h < nowH ? "past" : h === nowH ? "now" : "future");
  const visibleHours = showFuture ? hours : hours.filter((h) => hourState(h.hour) !== "future");
  const futureCount = hours.length - hours.filter((h) => hourState(h.hour) !== "future").length;

  const rows = useMemo(() => {
    let list = [...baseMachines];
    if (filter === "defects") list = list.filter((m) => m.defect > 0);
    else if (filter !== "all") list = list.filter((m) => m.status === filter);
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter((m) => String(m.mid).includes(k) || (m.operator || "").toLowerCase().includes(k));
    }
    const sorters = {
      total: (a, b) => b.total - a.total,
      eff: (a, b) => b.eff - a.eff,
      last: (a, b) => b.lastHourOut - a.lastHourOut,
      problems: (a, b) => (a.status === "running") - (b.status === "running") || b.defect - a.defect,
      machine: (a, b) => a.mid - b.mid,
    };
    return list.sort(sorters[sortBy] || sorters.total);
  }, [baseMachines, filter, q, sortBy]);

  const counts = useMemo(() => {
    const c = { all: baseMachines.length, defects: baseMachines.filter((m) => m.defect > 0).length };
    for (const f of ["running", "slow", "idle", "down", "notstarted"]) c[f] = baseMachines.filter((m) => m.status === f).length;
    return c;
  }, [baseMachines]);

  const rowH = compact ? "h-[22px]" : "h-[30px]";
  const cellText = compact ? "text-[10.5px]" : "text-[11.5px]";
  const lineRunning = (D.totals?.active_stations || 0) > 0;

  const hourTotals = visibleHours.map((h) => rows.reduce((a, m) => a + (Number(m.byHour[String(h.hour)]) || 0), 0));

  return (
    <Panel
      id="sec-machines"
      title="Machine Hourly Output"
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-400">operation-level pcs (not finished garments)</span>
          <label className="flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5">
            <Search className="h-3 w-3 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="machine / operator" className="w-28 border-0 p-0 text-[11px] focus:outline-none" />
          </label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rounded-md border border-slate-200 px-1 py-0.5 text-[11px]">
            <option value="total">Total ▼</option>
            <option value="eff">Efficiency</option>
            <option value="last">Last hour</option>
            <option value="problems">Problems first</option>
            <option value="machine">Machine no</option>
          </select>
          <button type="button" onClick={() => setCompact(!compact)} className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            {compact ? "Comfort" : "Compact"}
          </button>
        </div>
      }
    >
      {/* summary filter chips + line working-hour totals */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition ${filter === f.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {f.label} {counts[f.id] ?? 0}
          </button>
        ))}
        {noPunchCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowNoPunch(!showNoPunch)}
            className={`rounded-full border border-dashed px-2.5 py-0.5 text-[11px] font-bold transition ${showNoPunch ? "border-slate-500 bg-slate-600 text-white" : "border-slate-300 bg-white text-slate-400 hover:text-slate-600"}`}
            title={showNoPunch ? "Hide machines without a punch today" : "Show machines without a punch today"}
          >
            {showNoPunch ? "Hide" : "+"} {noPunchCount} no punch
          </button>
        ) : null}
        {staff?.totals?.staff ? (
          <span className="ml-auto inline-flex flex-wrap items-center gap-x-2 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-900 ring-1 ring-indigo-100 tabular-nums">
            <span>Staff {staff.totals.staff}</span>
            <span className="text-indigo-300">|</span>
            <span>Working {staff.totals.working_display}</span>
            <span className="text-indigo-300">|</span>
            <span>Break {staff.totals.break_display} (1h/staff)</span>
            <span className="text-indigo-300">|</span>
            <span className="font-bold">Actual {staff.totals.actual_display}</span>
          </span>
        ) : null}
      </div>

      <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
        <table className="min-w-full border-separate border-spacing-0 text-center tabular-nums">
          <thead className="sticky top-0 z-20">
            <tr className={`${cellText} font-bold uppercase tracking-wide text-slate-500`}>
              <th className="sticky left-0 z-30 border-b border-slate-200 bg-slate-50 px-2 py-1 text-left">Machine</th>
              {visibleHours.map((h) => (
                <th key={h.hour} className={`border-b border-slate-200 bg-slate-50 px-1 py-1 ${hourState(h.hour) === "now" ? "text-blue-700" : ""}`}>
                  {h.label}
                  {hourState(h.hour) === "now" ? <span className="ml-0.5 animate-pulse text-[8px] text-blue-600">●live</span> : null}
                </th>
              ))}
              {!showFuture && futureCount > 0 ? (
                <th className="cursor-pointer border-b border-slate-200 bg-slate-50 px-1 py-1 text-slate-400 hover:text-slate-600" onClick={() => setShowFuture(true)} title="Show future hours">
                  +{futureCount}h ▸
                </th>
              ) : null}
              {showFuture ? (
                <th className="cursor-pointer border-b border-slate-200 bg-slate-50 px-1 py-1 text-slate-400" onClick={() => setShowFuture(false)}>◂</th>
              ) : null}
              <th className="border-b border-slate-200 bg-slate-100 px-2 py-1">Total</th>
              <th className="border-b border-slate-200 bg-slate-50 px-1 py-1">Avg/hr</th>
              <th className="border-b border-slate-200 bg-slate-50 px-1 py-1">Eff%</th>
              <th className="border-b border-slate-200 bg-slate-50 px-1 py-1">Trend</th>
              <th className="border-b border-slate-200 bg-slate-50 px-1 py-1">Status</th>
              <th className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const pill = STATUS_PILL[m.status] || STATUS_PILL.running;
              const staffRows = staff?.machines?.[String(m.mid)] || [];
              return (
                <tr key={m.mid} className={`${rowH} ${cellText}`}>
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-0.5 text-left align-middle">
                    <button type="button" onClick={() => setDrawer({ machine: m })} className="flex min-w-0 items-center gap-1 hover:text-blue-700">
                      <span className="font-bold text-slate-800">M{m.mid}</span>
                      {m.operator && !staffRows.length ? <span className="max-w-[110px] truncate text-[10px] text-slate-400">{m.operator}</span> : null}
                      <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
                    </button>
                    {staffRows.map((s) => (
                      <div key={s.operator_id} className="flex items-center gap-1 whitespace-nowrap text-[9.5px] leading-tight text-slate-500" title={`${s.name} · IN ${s.in_time} · OUT ${s.out_time} · ${s.working_display} (actual ${s.actual_display})`}>
                        <span className="max-w-[90px] truncate font-semibold text-slate-600">{s.name}</span>
                        <span className="tabular-nums">{s.in_time}{s.out_time !== "—" ? `–${s.out_time}` : ""}</span>
                        <span className={`rounded px-1 font-bold tabular-nums ${s.still_in ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{s.working_display}</span>
                      </div>
                    ))}
                  </td>
                  {visibleHours.map((h) => {
                    const v = Number(m.byHour[String(h.hour)]) || 0;
                    const st = hourState(h.hour);
                    const npt = m.nptHourBadges[h.hour];
                    return (
                      <td
                        key={h.hour}
                        onClick={() => setDrawer({ machine: m, hour: h })}
                        className={`relative cursor-pointer border-b border-slate-100 px-1 ${st === "now" ? "outline outline-1 outline-blue-400" : ""}`}
                        style={cellStyle(v, m.machineHourTarget, st, lineRunning)}
                        title={`M${m.mid} ${h.label}: ${v} pcs${m.machineHourTarget ? ` / ${Math.round(m.machineHourTarget)} (${Math.round((v / m.machineHourTarget) * 100)}%)` : ""}${npt ? ` · NPT ${npt}m` : ""}${m.operator ? ` · ${m.operator}` : ""}`}
                      >
                        {st === "future" ? "" : v || "0"}
                        {npt ? <span className="absolute right-0 top-0 text-[8px]">⏸</span> : null}
                        {mach.bottleneck[h.hour] === m.mid && st !== "future" ? <span className="absolute bottom-0 left-0 text-[8px]" title="Bottleneck this hour">▾</span> : null}
                      </td>
                    );
                  })}
                  {!showFuture && futureCount > 0 ? <td className="border-b border-slate-100 bg-slate-50/60 text-slate-300">·</td> : null}
                  {showFuture ? <td className="border-b border-slate-100" /> : null}
                  <td className="border-b border-slate-100 bg-slate-50 px-2 font-bold text-slate-800">{fmt(m.total)}</td>
                  <td className="border-b border-slate-100 px-1 text-slate-600">{Math.round(m.avg)}</td>
                  <td className={`border-b border-slate-100 px-1 font-semibold ${m.eff >= 80 ? "text-emerald-700" : m.eff >= 50 ? "text-amber-700" : "text-rose-700"}`}>
                    {m.machineHourTarget ? `${Math.round(m.eff)}` : "—"}
                  </td>
                  <td className="border-b border-slate-100 px-1">
                    <span className="inline-flex items-center gap-0.5">
                      <Spark values={m.spark} width={compact ? 42 : 56} height={compact ? 14 : 18} />
                      {m.trend > 0 ? <ArrowUp className="h-3 w-3 text-emerald-600" /> : m.trend < 0 ? <ArrowDown className="h-3 w-3 text-rose-600" /> : <Minus className="h-3 w-3 text-slate-300" />}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-1">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${pill.cls}`}>{pill.label}</span>
                  </td>
                  <td className="max-w-[230px] truncate border-b border-slate-100 px-2 text-left text-[10.5px] font-medium text-slate-600" title={m.action}>
                    {m.action}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr className={`${cellText} font-bold`}>
              <td className="sticky left-0 z-30 border-t-2 border-slate-300 bg-slate-100 px-2 text-left text-slate-700">LINE TOTAL</td>
              {visibleHours.map((h, i) => (
                <td key={h.hour} className="border-t-2 border-slate-300 bg-slate-100 px-1 text-slate-800">{hourTotals[i] || "·"}</td>
              ))}
              {!showFuture && futureCount > 0 ? <td className="border-t-2 border-slate-300 bg-slate-100" /> : null}
              {showFuture ? <td className="border-t-2 border-slate-300 bg-slate-100" /> : null}
              <td className="border-t-2 border-slate-300 bg-slate-200 px-2 text-slate-900">{fmt(rows.reduce((a, m) => a + m.total, 0))}</td>
              <td colSpan={4} className="border-t-2 border-slate-300 bg-slate-100" />
              <td className="border-t-2 border-slate-300 bg-slate-100 px-2 text-left text-[10px] font-semibold text-slate-400">▾ = bottleneck of that hour</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {drawer ? <MachineDrawer drawer={drawer} D={D} onClose={() => setDrawer(null)} hours={hours} staffRows={staff?.machines?.[String(drawer.machine.mid)] || []} /> : null}
    </Panel>
  );
}

/** Side drawer: hour details, NPT events, quality summary for one machine. */
function MachineDrawer({ drawer, D, onClose, hours, staffRows = [] }) {
  const m = drawer.machine;
  const nptRows = (D.npt?.rows || []).filter((r) => Number(r.machin_id) === m.mid);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="h-full w-full max-w-sm overflow-auto bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-slate-900">M{m.mid}</div>
            <div className="text-[12px] text-slate-500">{m.operator || "operator unknown"}{m.operation ? ` · ${m.operation}` : ""}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 py-1.5"><div className="text-[9px] font-bold uppercase text-slate-400">Total</div><div className="text-[16px] font-bold tabular-nums">{m.total}</div></div>
          <div className="rounded-lg bg-amber-50 py-1.5"><div className="text-[9px] font-bold uppercase text-amber-600">Defect</div><div className="text-[16px] font-bold tabular-nums text-amber-700">{m.defect}</div></div>
          <div className="rounded-lg bg-violet-50 py-1.5"><div className="text-[9px] font-bold uppercase text-violet-600">NPT</div><div className="text-[16px] font-bold tabular-nums text-violet-700">{m.nptMin}m</div></div>
        </div>
        {staffRows.length ? (
          <>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Staff today</div>
            <ul className="mb-3 space-y-1 text-[12px]">
              {staffRows.map((s) => (
                <li key={s.operator_id} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-800">{s.name}</span>
                    {s.still_in ? <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">IN</span> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-slate-500">
                    <span>In {s.in_time}</span>
                    <span>Out {s.out_time}</span>
                    <span>Working {s.working_display}</span>
                    <span>Actual {s.actual_display}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Hour by hour</div>
        <table className="mb-3 w-full text-[12px] tabular-nums">
          <tbody>
            {hours.map((h) => {
              const v = Number(m.byHour[String(h.hour)]) || 0;
              const sel = drawer.hour?.hour === h.hour;
              return (
                <tr key={h.hour} className={sel ? "bg-blue-50 font-bold" : ""}>
                  <td className="border-b border-slate-100 py-1 text-slate-500">{h.label}</td>
                  <td className="border-b border-slate-100 py-1 text-right font-semibold text-slate-800">{v}</td>
                  <td className="border-b border-slate-100 py-1 pl-2 text-right text-slate-400">
                    {m.machineHourTarget ? `${Math.round((v / m.machineHourTarget) * 100)}%` : ""}
                    {m.nptHourBadges[h.hour] ? ` · ⏸${m.nptHourBadges[h.hour]}m` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">NPT events</div>
        {nptRows.length ? (
          <ul className="space-y-1 text-[12px]">
            {nptRows.map((r, i) => (
              <li key={i} className={`rounded-lg px-2 py-1 ${r.is_open ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>
                {r.category} · {r.start_at?.slice(0, 5)}{r.stop_at ? `–${r.stop_at.slice(0, 5)}` : " (running)"} · {r.is_open ? `${hhmm(minutesSince(r.start_at))} so far` : hhmm(r.minutes)}
                {r.reason ? ` — ${r.reason}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[12px] text-slate-400">No NPT today.</div>
        )}
        <div className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] font-semibold text-slate-700">Action: {m.action}</div>
      </div>
    </div>
  );
}
