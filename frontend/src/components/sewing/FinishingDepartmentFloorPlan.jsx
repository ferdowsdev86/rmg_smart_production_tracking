import { ArrowDown } from "lucide-react";
import {
  DEFAULT_FINISHING_PROCESSES,
  buildProcessStationSlots,
  getProcessStationTotal,
  groupSlotsByProcess,
  mergeLiveMachinesIntoSlots,
} from "./finishingProcessLibrary";
import { FinishingStationTile } from "./FinishingStationTile";

function FlowArrow() {
  return (
    <div className="flex justify-center py-2 text-slate-400" aria-hidden>
      <ArrowDown className="h-7 w-7 stroke-[2.5]" />
    </div>
  );
}

function ProcessSection({ section }) {
  const { process, stations } = section;
  const liveCount = stations.filter((s) => s.hasLiveData).length;

  return (
    <section className={`rounded-xl border-2 p-4 md:p-5 ${process.panel}`}>
      <div className={`mb-3 rounded-lg px-3 py-2 text-center ${process.titleBar}`}>
        <h3 className="text-base font-bold md:text-lg">
          {process.order}. {process.name}
        </h3>
        <p className="text-xs font-medium opacity-90">
          {process.stationCount} station{process.stationCount === 1 ? "" : "s"}
          {liveCount > 0 ? ` · ${liveCount} live` : ""} — {process.caption}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2 md:gap-3">
        {stations.map((station) => (
          <FinishingStationTile
            key={station.slotId}
            station={station}
            process={process}
            label={station.stationLabel}
          />
        ))}
      </div>

      {process.id === "waist-band-ironing" || process.id === "top-side-ironing" ? (
        <p className="mt-3 text-center text-[10px] font-medium text-orange-900/70">Steam / press unit</p>
      ) : null}
    </section>
  );
}

function PlanLegend({ processes }) {
  const unique = [];
  const seen = new Set();
  for (const p of processes) {
    if (seen.has(p.legendLabel)) continue;
    seen.add(p.legendLabel);
    unique.push(p);
  }
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-2 border-b border-slate-200 pb-4 text-[10px] font-medium text-slate-700">
      {unique.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-4 rounded border ${p.tile}`} />
          {p.legendLabel}
        </span>
      ))}
    </div>
  );
}

export function FinishingDepartmentFloorPlan({ data, processes = DEFAULT_FINISHING_PROCESSES }) {
  const apiMachines = data?.machines ?? [];
  const slots = mergeLiveMachinesIntoSlots(buildProcessStationSlots(processes), apiMachines);
  const sections = groupSlotsByProcess(slots, processes);
  const floor = data?.floor ?? "—";
  const lineNo = data?.line_no ?? "—";
  const filterDate = data?.filter_date ?? "—";
  const stationTotal = getProcessStationTotal(processes);
  const liveTotal = slots.filter((s) => s.hasLiveData).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm md:px-8">
        <h2 className="text-center text-lg font-bold text-slate-900 md:text-xl">
          Finishing department — floor plan (top view)
        </h2>
        <p className="mt-1 text-center text-sm text-slate-600">
          Floor {floor} · Line {lineNo} · {filterDate} · {stationTotal} stations / {processes.length}{" "}
          processes
          {liveTotal > 0 ? ` · ${liveTotal} linked to line_layout` : ""}
        </p>
        <div className="mt-4">
          <PlanLegend processes={processes} />
        </div>
      </div>

      <div className="space-y-0">
        {sections.map((section, i) => (
          <div key={section.process.id}>
            <ProcessSection section={section} />
            {i < sections.length - 1 ? <FlowArrow /> : null}
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-slate-500">
        {stationTotal} configured slots in process order · Live machines mapped by machin_no · Working &amp; OT
        from sewing_log
      </p>
    </div>
  );
}
