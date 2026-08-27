/**
 * Finishing line process helpers.
 * Process definitions load from GET /api/floors/finishing-processes/ (finishing_process table).
 */

/** @typedef {{ order: number, id: string, name: string, stationCount: number, code: string, caption: string, legendLabel: string, panel: string, titleBar: string, tile: string, tileMuted: string }} FinishingProcess */

/** Fallback when API is unavailable (matches seed_finishing_processes). */
export const DEFAULT_FINISHING_PROCESSES = [
  {
    order: 1,
    id: "loop-cutting",
    name: "Loop cutting",
    stationCount: 2,
    code: "LC",
    caption: "Loop trim stations",
    legendLabel: "Loop cutting",
    panel: "bg-emerald-50 border-emerald-300",
    titleBar: "bg-emerald-200/90 text-emerald-950",
    tile: "bg-emerald-400 border-emerald-700 text-emerald-950",
    tileMuted: "bg-emerald-200/70 border-emerald-400 text-emerald-900",
  },
  {
    order: 2,
    id: "top-thread-cutting",
    name: "Top side thread cutting",
    stationCount: 2,
    code: "TT",
    caption: "Top panel thread trim",
    legendLabel: "Top thread cut",
    panel: "bg-lime-50 border-lime-300",
    titleBar: "bg-lime-200/90 text-lime-950",
    tile: "bg-lime-500 border-lime-700 text-lime-950",
    tileMuted: "bg-lime-200/70 border-lime-400",
  },
  {
    order: 3,
    id: "top-quality-check",
    name: "Top side quality check",
    stationCount: 2,
    code: "TQ",
    caption: "Top inline QC",
    legendLabel: "Top QC",
    panel: "bg-pink-50 border-pink-300",
    titleBar: "bg-pink-200/90 text-pink-950",
    tile: "bg-pink-300 border-pink-500 text-pink-950",
    tileMuted: "bg-pink-100 border-pink-300",
  },
  {
    order: 4,
    id: "inside-thread-cutting",
    name: "Inside thread cutting",
    stationCount: 3,
    code: "IC",
    caption: "Inside thread trim",
    legendLabel: "Inside thread",
    panel: "bg-teal-50 border-teal-300",
    titleBar: "bg-teal-200/90 text-teal-950",
    tile: "bg-teal-400 border-teal-600 text-teal-950",
    tileMuted: "bg-teal-200/70 border-teal-400",
  },
  {
    order: 5,
    id: "pocket-reinforcement",
    name: "Inside back pocket reinforcement cutting",
    stationCount: 1,
    code: "BR",
    caption: "Pocket reinforcement",
    legendLabel: "Pocket reinf.",
    panel: "bg-cyan-50 border-cyan-300",
    titleBar: "bg-cyan-200/90 text-cyan-950",
    tile: "bg-cyan-500 border-cyan-700 text-white",
    tileMuted: "bg-cyan-200/70 border-cyan-400",
  },
  {
    order: 6,
    id: "waist-band-ironing",
    name: "Inside waist band ironing",
    stationCount: 2,
    code: "WI",
    caption: "Waist band press",
    legendLabel: "Waist iron",
    panel: "bg-orange-50 border-orange-300",
    titleBar: "bg-orange-200/90 text-orange-950",
    tile: "bg-orange-400 border-orange-600 text-orange-950",
    tileMuted: "bg-orange-200/70 border-orange-400",
  },
  {
    order: 7,
    id: "inside-quality-check",
    name: "Inside quality check",
    stationCount: 2,
    code: "IQ",
    caption: "Inside inline QC",
    legendLabel: "Inside QC",
    panel: "bg-rose-50 border-rose-300",
    titleBar: "bg-rose-200/90 text-rose-950",
    tile: "bg-rose-300 border-rose-500 text-rose-950",
    tileMuted: "bg-rose-100 border-rose-300",
  },
  {
    order: 8,
    id: "thread-shaking",
    name: "Thread shaking",
    stationCount: 1,
    code: "TS",
    caption: "Loose thread shake-off",
    legendLabel: "Thread shake",
    panel: "bg-amber-50 border-amber-300",
    titleBar: "bg-amber-200/90 text-amber-950",
    tile: "bg-amber-400 border-amber-600 text-amber-950",
    tileMuted: "bg-amber-200/70 border-amber-400",
  },
  {
    order: 9,
    id: "button-attach",
    name: "Button attach",
    stationCount: 4,
    code: "BA",
    caption: "Button sewing",
    legendLabel: "Button",
    panel: "bg-indigo-50 border-indigo-300",
    titleBar: "bg-indigo-200/90 text-indigo-950",
    tile: "bg-indigo-500 border-indigo-700 text-white",
    tileMuted: "bg-indigo-200/70 border-indigo-400",
  },
  {
    order: 10,
    id: "top-side-ironing",
    name: "Top side ironing",
    stationCount: 4,
    code: "TI",
    caption: "Top press tables",
    legendLabel: "Top iron",
    panel: "bg-orange-50/80 border-orange-400",
    titleBar: "bg-orange-300/90 text-orange-950",
    tile: "bg-orange-500 border-orange-700 text-white",
    tileMuted: "bg-orange-200/70 border-orange-500",
  },
  {
    order: 11,
    id: "final-trim",
    name: "Final trim",
    stationCount: 2,
    code: "FT",
    caption: "Final trim stations",
    legendLabel: "Final trim",
    panel: "bg-sky-50 border-sky-300",
    titleBar: "bg-sky-200/90 text-sky-950",
    tile: "bg-sky-400 border-sky-600 text-sky-950",
    tileMuted: "bg-sky-200/70 border-sky-400",
  },
  {
    order: 12,
    id: "measurement-check",
    name: "Measurement check",
    stationCount: 2,
    code: "MC",
    caption: "Size / spec check",
    legendLabel: "Measurement",
    panel: "bg-violet-50 border-violet-300",
    titleBar: "bg-violet-200/90 text-violet-950",
    tile: "bg-violet-400 border-violet-600 text-violet-50",
    tileMuted: "bg-violet-200/70 border-violet-400",
  },
  {
    order: 13,
    id: "getup",
    name: "Getup",
    stationCount: 2,
    code: "GU",
    caption: "Garment getup",
    legendLabel: "Getup",
    panel: "bg-fuchsia-50 border-fuchsia-300",
    titleBar: "bg-fuchsia-200/90 text-fuchsia-950",
    tile: "bg-fuchsia-500 border-fuchsia-700 text-white",
    tileMuted: "bg-fuchsia-200/70 border-fuchsia-400",
  },
  {
    order: 14,
    id: "waist-tack-attach",
    name: "Waist tack attach",
    stationCount: 1,
    code: "WT",
    caption: "Waist tack",
    legendLabel: "Waist tack",
    panel: "bg-slate-100 border-slate-400",
    titleBar: "bg-slate-300/90 text-slate-900",
    tile: "bg-slate-500 border-slate-700 text-white",
    tileMuted: "bg-slate-300 border-slate-500",
  },
  {
    order: 15,
    id: "hand-tack-attach",
    name: "Hand tack attach",
    stationCount: 1,
    code: "HT",
    caption: "Hand tack finish",
    legendLabel: "Hand tack",
    panel: "bg-stone-100 border-stone-400",
    titleBar: "bg-stone-300/90 text-stone-900",
    tile: "bg-stone-600 border-stone-800 text-white",
    tileMuted: "bg-stone-300 border-stone-500",
  },
];

/** @deprecated Use processes from API; kept for imports that expect FINISHING_PROCESSES */
export const FINISHING_PROCESSES = DEFAULT_FINISHING_PROCESSES;

export function getProcessStationTotal(processes = DEFAULT_FINISHING_PROCESSES) {
  return processes.reduce((n, p) => n + p.stationCount, 0);
}

export function buildProcessStationSlots(processes = DEFAULT_FINISHING_PROCESSES) {
  const slots = [];
  for (const process of processes) {
    for (let i = 1; i <= process.stationCount; i += 1) {
      const label = `${process.code}-${String(i).padStart(2, "0")}`;
      slots.push({
        slotId: `${process.id}-${i}`,
        slotIndex: slots.length + 1,
        process,
        stationLabel: label,
        machin_name: label,
        process_name: process.name,
        isConfigured: true,
        hasLiveData: false,
        operator_name: "—",
        operator_id: "",
        operator_photo_url: null,
        status: "offline",
        traffic_light_active: false,
        workstation_problem: "INACTIVE",
        in_time: "—",
        working_hour_display: "0h 0m 0s",
        non_productive_display: "0h 0m 0s",
        ot_hour_display: "0h 0m 0s",
        machin_no: null,
      });
    }
  }
  return slots;
}

export function mergeLiveMachinesIntoSlots(slots, apiMachines) {
  const live = [...(apiMachines ?? [])]
    .filter((m) => m && !m.virtual)
    .sort((a, b) => (a.machin_no ?? 0) - (b.machin_no ?? 0));

  return slots.map((slot, i) => {
    const api = live[i];
    if (!api) return slot;
    return {
      ...slot,
      ...api,
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      process: slot.process,
      process_name: slot.process.name,
      stationLabel: slot.stationLabel,
      hasLiveData: true,
      machin_name: api.machin_name || slot.stationLabel,
    };
  });
}

export function groupSlotsByProcess(slots, processes = DEFAULT_FINISHING_PROCESSES) {
  return processes.map((process) => ({
    process,
    stations: slots.filter((s) => s.process.id === process.id),
  }));
}
