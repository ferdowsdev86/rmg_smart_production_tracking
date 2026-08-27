import { Factory } from "lucide-react";
import { SewingStationCard } from "./SewingStationCard";

/** Left / right of vertical supply table; rows aligned by index. */
function buildSideRows(machines) {
  if (!machines?.length) return [];
  const half = Math.ceil(machines.length / 2);
  const left = machines.slice(0, half);
  const right = machines.slice(half);
  const len = Math.max(left.length, right.length);
  return Array.from({ length: len }, (_, i) => ({
    left: left[i] ?? null,
    right: right[i] ?? null,
  }));
}

function machineSlotLabel(allMachines, m) {
  const i = allMachines.findIndex((x) => x.machin_no === m.machin_no && x.id === m.id);
  return i >= 0 ? `Machin ${i + 1}` : m.machin_name || "Machin";
}

function SupplyTableVertical() {
  return (
    <div className="relative flex w-16 shrink-0 flex-col items-center md:w-24 lg:w-20" aria-label="Supply table">
      <div className="flex min-h-full w-full flex-1 flex-col items-center justify-center rounded-xl border-2 border-emerald-600/90 bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700 px-1 py-5 shadow-md shadow-emerald-600/20 md:px-1.5 md:py-6">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-white md:text-[11px] md:tracking-[0.22em]"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          Supply Table
        </span>
      </div>
    </div>
  );
}

function LineStationCell({ station, allMachines, side = "left" }) {
  if (!station) {
    return <div className="min-h-[120px] w-full max-w-[360px]" aria-hidden />;
  }

  return (
    <div className={side === "left" ? "ml-auto w-full max-w-[400px]" : "mr-auto w-full max-w-[400px]"}>
      <SewingStationCard
        station={station}
        variant="work"
        layout="line"
        side={side}
        slotLabel={machineSlotLabel(allMachines, station)}
      />
    </div>
  );
}

function SideColumn({ rows, side, allMachines }) {
  return (
    <div
      className={[
        "flex min-w-0 flex-1 flex-col gap-4 py-1",
        side === "left" ? "items-end pr-1 md:pr-2" : "items-start pl-1 md:pl-2",
      ].join(" ")}
    >
      {rows.map((row, i) => (
        <LineStationCell
          key={`${side}-${row[side]?.machin_no ?? `empty-${i}`}`}
          station={row[side]}
          allMachines={allMachines}
          side={side}
        />
      ))}
    </div>
  );
}

export function SewingLineBoard({ data }) {
  if (!data) return null;

  const machines = data.machines ?? [];
  const gsd = data.gsd ?? {};
  const rows = buildSideRows(machines);

  const floor = data.floor ?? "—";
  const lineNo = String(data.line_no ?? "—").padStart(2, "0");

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl">
        <div className="flex flex-wrap items-stretch justify-between gap-4 px-5 py-4 md:px-8">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 p-3 ring-1 ring-white/10">
              <Factory className="h-7 w-7 text-cyan-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="rounded-lg bg-white/10 px-3 py-1 text-sm font-semibold tabular-nums">
                  Floor = {floor}
                </span>
                <span className="rounded-lg bg-cyan-500/20 px-3 py-1 text-sm font-semibold text-cyan-200 tabular-nums ring-1 ring-cyan-400/30">
                  Line: {lineNo}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-white/95">{data.line_label}</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {data.filter_date} · {machines.length} stations · vertical supply layout
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 sm:gap-5">
            {[
              { label: "Total Machin", value: gsd.stations_total ?? machines.length, color: "text-white" },
              { label: "Active", value: gsd.present ?? 0, color: "text-emerald-400" },
              { label: "Running", value: gsd.running ?? 0, color: "text-sky-300" },
              { label: "Problem", value: gsd.problem ?? 0, color: "text-red-400" },
              { label: "Idle", value: gsd.offline ?? 0, color: "text-slate-400" },
            ].map((k) => (
              <div
                key={k.label}
                className="min-w-[64px] rounded-xl bg-black/20 px-3 py-2 text-center ring-1 ring-white/5"
              >
                <div className={`text-2xl font-bold tabular-nums ${k.color}`}>{k.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{k.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-b from-slate-100 via-white to-slate-50 p-4 shadow-inner md:p-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.3]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgb(148 163 184 / 0.12) 1px, transparent 1px),
              linear-gradient(to bottom, rgb(148 163 184 / 0.12) 1px, transparent 1px)
            `,
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative mx-auto flex w-full max-w-[1400px] flex-row items-stretch gap-2 md:gap-4">
          <SideColumn rows={rows} side="left" allMachines={machines} />
          <SupplyTableVertical />
          <SideColumn rows={rows} side="right" allMachines={machines} />
        </div>

        <div className="relative mt-8 flex flex-wrap justify-center gap-4 border-t border-slate-200/80 pt-5 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
            Green — OK
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            Red — problem
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-slate-400" />
            Gray — no activity
          </span>
          <span className="text-slate-400">· Left line · Supply center · Right line</span>
        </div>
      </div>
    </div>
  );
}
