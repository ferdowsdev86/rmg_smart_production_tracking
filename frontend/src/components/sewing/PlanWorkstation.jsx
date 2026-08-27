import { PlanOperatorBust } from "./PlanOperatorBust";

const DIM_BULB = "bg-slate-400/40 border-slate-500/30";

function MiniTrafficLight({ active, isRed }) {
  if (!active) {
    return (
      <div className="flex flex-col gap-0.5 rounded-md bg-slate-600/80 px-1 py-1">
        <div className={`h-2 w-2 rounded-full border ${DIM_BULB}`} />
        <div className={`h-2 w-2 rounded-full border ${DIM_BULB}`} />
        <div className={`h-2 w-2 rounded-full border ${DIM_BULB}`} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-slate-800 px-1 py-1 shadow-inner">
      <div
        className={`h-2 w-2 rounded-full border border-slate-900/40 ${
          isRed ? "bg-red-500" : DIM_BULB
        }`}
      />
      <div className={`h-2 w-2 rounded-full border border-slate-900/40 ${DIM_BULB}`} />
      <div
        className={`h-2 w-2 rounded-full border border-slate-900/40 ${
          !isRed ? "bg-emerald-500" : DIM_BULB
        }`}
      />
    </div>
  );
}

function SewingTable() {
  return (
    <div className="relative mx-auto mt-1 h-3 w-[72%] max-w-[88px]" aria-hidden>
      <div className="h-1.5 w-full rounded-sm bg-gradient-to-r from-amber-700 via-amber-600 to-amber-700 shadow-sm" />
      <div className="absolute -bottom-1 left-[12%] h-2 w-0.5 rounded-full bg-slate-500" />
      <div className="absolute -bottom-1 right-[12%] h-2 w-0.5 rounded-full bg-slate-500" />
    </div>
  );
}

function TimeRow({ label, value, accent = false }) {
  return (
    <div className="flex justify-between gap-1 text-[11px] leading-tight">
      <span className="font-medium text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ? "text-amber-800" : "text-slate-800"}`}>
        {value}
      </span>
    </div>
  );
}

export function PlanWorkstation({ station, slotIndex }) {
  if (!station) {
    return <div className="min-h-[200px] w-full max-w-[200px]" aria-hidden />;
  }

  const trafficActive = Boolean(station.traffic_light_active);
  const problemRed = trafficActive && station.workstation_problem === "RED Light";

  const skin = !trafficActive
    ? "border-slate-200 bg-gradient-to-b from-slate-50 to-white ring-slate-300"
    : problemRed
      ? "border-red-200 bg-gradient-to-b from-red-50/80 to-white ring-red-400"
      : "border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white ring-emerald-400";

  const startTime = station.start_time || station.in_time || "—";
  const breakTime = station.break_time_display || "0h 0m 0s";
  const outTime = station.out_time || "—";
  const totalWorking = station.total_working_display || station.working_display || "0h 0m 0s";

  return (
    <article
      className={[
        "flex w-full max-w-[200px] flex-col rounded-xl border-2 p-2.5 shadow-md ring-2 ring-offset-1",
        skin,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-1">
        <MiniTrafficLight active={trafficActive} isRed={problemRed} />
        <div className="min-w-0 flex-1 text-right">
          <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {station.machin_name || `St ${slotIndex}`}
          </p>
          <p className="text-lg font-extrabold tabular-nums text-slate-900">#{station.machin_no ?? "—"}</p>
        </div>
      </div>

      <div className="mt-1 flex flex-col items-center">
        <PlanOperatorBust
          status={station.status}
          operatorId={station.operator_id}
          photoUrl={station.operator_photo_url}
        />
        <SewingTable />
      </div>

      <p className="mt-1.5 truncate text-center text-[11px] font-semibold text-slate-800">
        {station.operator_name && station.operator_name !== "—" ? station.operator_name : "No operator"}
      </p>

      <div className="mt-2 space-y-1 border-t border-slate-200/80 pt-2">
        <TimeRow label="Start time" value={startTime} />
        <TimeRow label="Break time" value={breakTime} />
        <TimeRow label="Out time" value={outTime} />
        <TimeRow label="Total working" value={totalWorking} accent />
      </div>
    </article>
  );
}
