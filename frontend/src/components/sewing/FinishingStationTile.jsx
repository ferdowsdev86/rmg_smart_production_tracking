import { PlanOperatorBust } from "./PlanOperatorBust";

function MiniTable() {
  return <div className="mx-auto mt-0.5 h-1 w-[70%] rounded-sm bg-amber-800/80" aria-hidden />;
}

export function FinishingStationTile({ station, process, zone, label, variant = "default" }) {
  const theme = process || zone;
  const displayLabel = label || station.stationLabel || station.machin_name || `M-${station.machin_no ?? "?"}`;
  const isReject = variant === "reject";
  const isEmpty = !station.hasLiveData && !station.machin_no;

  const tileClass = isReject
    ? "border-2 border-dashed border-red-500 bg-red-50 text-red-800 min-w-[72px]"
    : `min-w-[92px] max-w-[118px] ${isEmpty ? theme.tileMuted : theme.tile}`;

  const working = station.working_hour_display || station.total_working_display || "0h 0m 0s";
  const ot = station.ot_hour_display || "0h 0m 0s";
  const trafficActive = Boolean(station.traffic_light_active);
  const problem = trafficActive && station.workstation_problem === "RED Light";

  return (
    <article
      className={[
        "flex flex-col rounded-lg border-2 px-2 py-2 shadow-sm transition-shadow hover:shadow-md",
        tileClass,
        problem ? "ring-2 ring-red-500 ring-offset-1" : "",
        isEmpty ? "opacity-85" : "",
      ].join(" ")}
      title={[station.process_name, station.operator_name].filter(Boolean).join(" · ") || undefined}
    >
      <p className="truncate text-center text-[10px] font-extrabold leading-tight">{displayLabel}</p>
      {!isReject ? (
        <>
          <div className="my-1 flex justify-center scale-[0.72]">
            <PlanOperatorBust
              status={station.status}
              operatorId={station.operator_id}
              photoUrl={station.operator_photo_url}
            />
          </div>
          <MiniTable />
          <p className="line-clamp-2 min-h-[22px] text-center text-[8px] font-medium leading-tight opacity-90">
            {station.process_name || theme?.name || "—"}
          </p>
          <p className="truncate text-center text-[9px] font-semibold">
            {station.operator_name && station.operator_name !== "—" ? station.operator_name : "No operator"}
          </p>
          <div className="mt-1 space-y-0.5 rounded bg-black/10 px-1.5 py-1 text-[9px] leading-tight">
            <div className="flex justify-between gap-1">
              <span className="opacity-80">Working</span>
              <span className="font-bold tabular-nums">{working}</span>
            </div>
            <div className="flex justify-between gap-1">
              <span className="opacity-80">OT</span>
              <span className="font-bold tabular-nums">{ot}</span>
            </div>
          </div>
          {station.machin_no ? (
            <p className="mt-0.5 text-center text-[8px] tabular-nums opacity-75">#{station.machin_no}</p>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
