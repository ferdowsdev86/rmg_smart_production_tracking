import { useState } from "react";
import { formatSmartDuration } from "../../lib/duration";
import { OperatorAvatar3D } from "./OperatorAvatar3D";

const DIM_BULB = "bg-slate-400/40 border-slate-500/30 shadow-none";

function TrafficLight({ active, isRed, onLightBg = false }) {
  const housing = onLightBg
    ? "bg-slate-700/90 shadow-inner"
    : active
      ? "bg-slate-800 shadow-inner"
      : "bg-slate-600 shadow-inner";

  if (!active) {
    return (
      <div
        className={`flex flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 ${housing}`}
        title="No activity on selected date"
        aria-label="Workstation inactive"
      >
        <div className={`h-3.5 w-3.5 rounded-full border ${DIM_BULB}`} />
        <div className={`h-3.5 w-3.5 rounded-full border ${DIM_BULB}`} />
        <div className={`h-3.5 w-3.5 rounded-full border ${DIM_BULB}`} />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 ${housing}`}
      title={isRed ? "Workstation problem" : "Workstation OK"}
      aria-label={isRed ? "Workstation problem — red" : "Workstation OK — green"}
    >
      <div
        className={[
          "h-3.5 w-3.5 rounded-full border border-slate-900/40",
          isRed ? "bg-red-500 shadow-[0_0_6px_1px_rgba(239,68,68,0.9)]" : DIM_BULB,
        ].join(" ")}
      />
      <div className={`h-3.5 w-3.5 rounded-full border border-slate-900/40 ${DIM_BULB}`} />
      <div
        className={[
          "h-3.5 w-3.5 rounded-full border border-slate-900/40",
          !isRed ? "bg-emerald-500 shadow-[0_0_6px_1px_rgba(16,185,129,0.9)]" : DIM_BULB,
        ].join(" ")}
      />
    </div>
  );
}

function railUserInitials(station) {
  const name = (station.operator_name || "").trim();
  if (name && name !== "—") {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  const id = String(station.operator_id || "").trim();
  return id && id !== "—" ? id.slice(-2).toUpperCase() : "—";
}

/** Operator photo centered in the line-card rail (HR image or initials). */
function RailUserPhoto({ station }) {
  const [imgFailed, setImgFailed] = useState(false);
  const photoUrl = station.operator_photo_url;
  const showPhoto = photoUrl && !imgFailed;
  const initials = railUserInitials(station);

  if (showPhoto) {
    return (
      <div className="h-[80px] w-[80px] overflow-hidden rounded-full ring-[3px] ring-white shadow-lg">
        <img
          src={photoUrl}
          alt={station.operator_name || "Operator"}
          className="h-full w-full object-cover object-top"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-[80px] w-[80px] items-center justify-center rounded-full bg-gradient-to-b from-slate-200 to-slate-300 ring-[3px] ring-white shadow-md"
      title={station.operator_name || undefined}
    >
      <span className="text-2xl font-bold text-slate-600">{initials}</span>
    </div>
  );
}

function InfoRow({ label, value, valueClass = "" }) {
  return (
    <div className="flex justify-between gap-2 border-b border-slate-200/80 py-1.5 last:border-0">
      <span className="shrink-0 text-[11px] font-medium text-slate-500/90">{label}</span>
      <span className={`text-right text-[12px] font-semibold tabular-nums leading-snug ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function formatDurationHms(seconds, fallback = "0h 0m 0s") {
  if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return fallback;
  const total = Math.floor(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${m}m ${s}s`;
}

function stationWorkingTime(station) {
  const seconds = Number(station.present_duration_seconds);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return formatDurationHms(seconds, "—");
  }
  if (station.working_display && station.working_display !== "—") return station.working_display;
  return "—";
}

function stationMachineRunTime(station) {
  if (station.machine_run_display && station.machine_run_display !== "—") {
    return station.machine_run_display;
  }
  return formatSmartDuration(station.runtime_total ?? 0, "0 sec");
}

function stationTrafficActive(station, isIo) {
  if (isIo) return false;
  if (station.present_status === "Active") return true;
  if (station.present_status === "InActive") return false;
  return Boolean(station.traffic_light_active);
}

function stationProblemRed(station, trafficActive) {
  if (!trafficActive) return false;
  return station.workstation_problem === "RED Light";
}

function stationNonProductiveTime(station) {
  const seconds = Number(station.non_productive_seconds);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return formatDurationHms(seconds, "0h 0m 0s");
  }
  if (station.non_productive_display) return station.non_productive_display;
  return "0h 0m 0s";
}

function SketchField({ label, value, valueClass = "text-slate-900", title, nowrap = false }) {
  return (
    <p
      className={[
        "text-base leading-snug text-slate-600",
        nowrap ? "flex min-w-0 flex-nowrap items-baseline overflow-hidden" : "",
      ].join(" ")}
      title={title || (nowrap && value ? String(value) : undefined)}
    >
      <span className="shrink-0 font-semibold">{label}</span>
      <span className="mx-0.5 shrink-0">=</span>
      <span
        className={[
          "font-bold tabular-nums",
          valueClass,
          nowrap ? "min-w-0 truncate whitespace-nowrap" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </p>
  );
}

function LineHeaderRow({ slNo, machineName, style }) {
  return (
    <div className="flex flex-nowrap items-baseline gap-x-4 overflow-hidden border-b border-blue-200/70 pb-2.5 text-base leading-tight text-slate-600">
      <span className="shrink-0 whitespace-nowrap">
        <span className="font-semibold">SL No</span>
        <span className="mx-0.5">=</span>
        <span className="font-bold tabular-nums text-blue-900">{slNo}</span>
      </span>
      <span className="min-w-0 truncate whitespace-nowrap" title={machineName}>
        <span className="font-semibold">Machine name</span>
        <span className="mx-0.5">=</span>
        <span className="font-bold text-blue-900">{machineName}</span>
      </span>
      {style ? (
        <span className="min-w-0 shrink-0 truncate whitespace-nowrap" title={style}>
          <span className="font-semibold">Style</span>
          <span className="mx-0.5">=</span>
          <span className="font-bold text-emerald-700">{style}</span>
        </span>
      ) : null}
    </div>
  );
}

function lineSlNo(station, slotLabel) {
  if (slotLabel) {
    const fromSlot = slotLabel.match(/Machine\s+(\d+)/i);
    if (fromSlot) return fromSlot[1];
  }
  const name = station.machin_name || "";
  const fromName = name.match(/SL[-\s]?(\d+)/i);
  if (fromName) return fromName[1];
  return "—";
}

function metricToneClass(tone) {
  const tones = {
    slate: "bg-slate-100/95 text-slate-900",
    blue: "bg-blue-100/95 text-blue-950",
    amber: "bg-amber-100/95 text-amber-950",
    emerald: "bg-emerald-100/95 text-emerald-950",
    red: "bg-red-100/95 text-red-900",
  };
  return tones[tone] || tones.slate;
}

function MetricTableCard({ rows, tone = "slate", compact = false }) {
  const textSize = compact ? "text-[10px]" : "text-[11px]";

  return (
    <div
      className={[
        "min-w-0 rounded-xl border border-slate-300/80 shadow-sm divide-y divide-slate-300/80",
        metricToneClass(tone),
      ].join(" ")}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center divide-x divide-slate-300/80"
          title={`${row.label}: ${row.value}`}
        >
          <span
            className={[
              "px-1.5 py-2 text-center font-bold uppercase tracking-wide text-slate-600",
              compact ? "text-[9px]" : "text-[10px]",
            ].join(" ")}
          >
            {row.label}
          </span>
          <span
            className={[
              "px-1.5 py-2 text-right font-extrabold tabular-nums leading-tight whitespace-nowrap",
              textSize,
            ].join(" ")}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function MetricInlineCard({ rows, tone = "blue", compact = false }) {
  const textSize = compact ? "text-[10px]" : "text-[11px]";

  return (
    <div
      className={[
        "min-w-0 rounded-xl border border-slate-300/80 shadow-sm divide-y divide-slate-300/80",
        metricToneClass(tone),
      ].join(" ")}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className={[
            "px-2 py-2 font-bold tabular-nums leading-tight whitespace-nowrap",
            textSize,
          ].join(" ")}
          title={`${row.label}: ${row.value}`}
        >
          <span className="uppercase tracking-wide text-slate-600">{row.label}:</span>{" "}
          <span className="font-extrabold">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function MetricTile({ label, value, tone = "slate", compact = false, title }) {
  return (
    <div
      className={[
        "flex min-w-0 flex-col items-center justify-center rounded-xl border border-slate-300/80 text-center shadow-sm",
        metricToneClass(tone),
        compact ? "min-h-[3.5rem] px-1.5 py-2" : "min-h-[4.25rem] px-2 py-2.5",
      ].join(" ")}
      title={title || `${label}: ${value}`}
    >
      <span
        className={[
          "font-bold uppercase tracking-wider text-slate-600",
          compact ? "text-[10px]" : "text-[11px]",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={[
          "mt-1 w-full whitespace-normal break-words font-extrabold tabular-nums leading-snug",
          compact ? "text-xs" : "text-sm",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function StationMetricsGrid({ station, compact = false }) {
  return (
    <div className={compact ? "space-y-2" : "space-y-2.5"}>
      <div className={`grid grid-cols-2 ${compact ? "gap-2" : "gap-2.5"}`}>
        <MetricTableCard
          compact={compact}
          tone="slate"
          rows={[
            { label: "In Tm", value: station.in_time || "—" },
            { label: "WT", value: stationWorkingTime(station) },
          ]}
        />
        <MetricInlineCard
          compact={compact}
          tone="blue"
          rows={[
            { label: "MRT", value: stationMachineRunTime(station) },
            { label: "NPT", value: stationNonProductiveTime(station) },
          ]}
        />
      </div>
      <div className={`grid grid-cols-3 ${compact ? "gap-2" : "gap-2.5"}`}>
        <MetricTile compact={compact} label="Target" value={station.daily_target ?? "—"} tone="emerald" />
        <MetricTile compact={compact} label="Defect" value={station.defect_total ?? 0} tone="red" />
        <MetricTile compact={compact} label="Prod" value={station.prod_total ?? 0} tone="emerald" />
      </div>
    </div>
  );
}

function LineStationPanel({ station, slotLabel }) {
  const machineName = station.machin_name || "—";

  return (
    <div className="space-y-2.5">
      <LineHeaderRow slNo={lineSlNo(station, slotLabel)} machineName={machineName} style={station.style} />

      <div className="space-y-1.5 border-b border-slate-200/70 pb-2.5">
        <SketchField
          label="User name"
          value={station.operator_name || "—"}
          valueClass="text-slate-900"
          nowrap
        />
        <SketchField
          label="Designation"
          value={station.operator_designation || "—"}
          valueClass="text-slate-800"
        />
      </div>

      <StationMetricsGrid station={station} />
    </div>
  );
}

function StationInfo({ station }) {
  return (
    <>
      <InfoRow label="Machine ID" value={station.machin_no ?? "—"} valueClass="text-slate-900" />
      <InfoRow label="USER Name" value={station.operator_name || "—"} valueClass="font-bold text-slate-900" />
      <InfoRow
        label="Designation"
        value={station.operator_designation || "—"}
        valueClass="font-semibold text-slate-800"
      />
      <InfoRow label="User ID" value={station.operator_id || "—"} valueClass="font-mono text-slate-900" />
      <div className="mt-2 border-t border-slate-200 pt-2">
        <StationMetricsGrid station={station} compact />
      </div>
    </>
  );
}

function LineLayoutCard({ station, slotLabel, side, trafficActive, problemRed }) {
  const statusStyles = !trafficActive
    ? {
        card: "border-slate-200/80 shadow-[0_8px_24px_rgba(100,116,139,0.12)] ring-slate-300/80",
        railTop: "bg-gradient-to-b from-slate-300 to-slate-400",
        railMid: "bg-gradient-to-b from-slate-100 to-slate-200",
        railBot: "bg-gradient-to-b from-slate-500 to-slate-600",
        panel: "bg-gradient-to-br from-white to-slate-50",
      }
    : problemRed
      ? {
          card: "border-red-300/60 shadow-[0_8px_28px_rgba(239,68,68,0.2)] ring-red-400/90",
          railTop: "bg-gradient-to-b from-sky-300 to-sky-400",
          railMid: "bg-gradient-to-b from-sky-50 to-sky-100",
          railBot: "bg-gradient-to-b from-red-600 to-red-800",
          panel: "bg-gradient-to-br from-white via-red-50/30 to-white",
        }
      : {
          card: "border-emerald-300/60 shadow-[0_8px_28px_rgba(16,185,129,0.22)] ring-emerald-400/90",
          railTop: "bg-gradient-to-b from-sky-300 to-sky-400",
          railMid: "bg-gradient-to-b from-sky-50 to-blue-100",
          railBot: "bg-gradient-to-b from-blue-600 to-blue-800",
          panel: "bg-gradient-to-br from-white via-emerald-50/40 to-sky-50/50",
        };

  return (
    <div
      className={[
        "flex w-full max-w-[460px] overflow-hidden rounded-2xl border-2 bg-white",
        "ring-2 ring-offset-2 transition-shadow duration-300 hover:shadow-xl",
        statusStyles.card,
        side === "right" ? "flex-row-reverse" : "flex-row",
      ].join(" ")}
    >
      <div className="flex w-[96px] shrink-0 flex-col shadow-[inset_-1px_0_0_rgba(255,255,255,0.2)]">
        <div className={`flex justify-center py-2.5 ${statusStyles.railTop}`}>
          <TrafficLight active={trafficActive} isRed={problemRed} onLightBg />
        </div>
        <div className={`flex flex-1 items-center justify-center py-3 ${statusStyles.railMid}`}>
          <RailUserPhoto station={station} />
        </div>
        <div className={`flex items-center justify-center py-3.5 ${statusStyles.railBot}`}>
          <span className="text-3xl font-extrabold tabular-nums leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]">
            {station.machin_no ?? "—"}
          </span>
        </div>
      </div>

      <div className={`min-w-0 flex-1 px-4 py-3.5 ${statusStyles.panel}`}>
        <LineStationPanel station={station} slotLabel={slotLabel} />
      </div>
    </div>
  );
}


export function SewingStationCard({
  station,
  variant = "work",
  compact = false,
  layout = "card",
  slotLabel = null,
  side = "left",
}) {
  const isLine = layout === "line";
  const isIo = variant === "input" || variant === "output";
  const trafficActive = stationTrafficActive(station, isIo);
  const problemRed = stationProblemRed(station, trafficActive);

  const cardSkin = isIo
    ? "border-dashed border-primary/30 bg-gradient-to-b from-blue-50/80 to-white ring-primary/30"
    : !trafficActive
      ? "border-slate-200 bg-gradient-to-b from-slate-50/90 to-white ring-slate-300"
      : problemRed
        ? "border-red-200 bg-gradient-to-b from-red-50/90 to-white ring-red-500"
        : "border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white ring-emerald-500";

  if (isLine && !isIo) {
    return (
      <LineLayoutCard
        station={station}
        slotLabel={slotLabel}
        side={side}
        trafficActive={trafficActive}
        problemRed={problemRed}
      />
    );
  }

  const sizeClass = compact
    ? "min-w-0 w-full max-w-[272px] p-2.5"
    : "min-w-[248px] max-w-[280px] p-3";

  return (
    <div
      className={[
        "relative flex flex-col rounded-2xl border shadow-card transition-shadow hover:shadow-md",
        sizeClass,
        cardSkin,
        "ring-2 ring-offset-2",
      ].join(" ")}
    >
      {!isIo ? (
        <div className="mb-2 flex justify-center">
          <TrafficLight active={trafficActive} isRed={problemRed} />
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-0.5">
        {!isIo && slotLabel ? (
          <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-800">
            {slotLabel}
          </span>
        ) : null}
        <span className="text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {variant === "input" ? "IN" : variant === "output" ? "OUT" : station.machin_name}
        </span>
      </div>

      {!isIo && station.machin_no ? (
        <div className="mt-1 text-center text-lg font-semibold tabular-nums text-slate-900">
          #{station.machin_no}
        </div>
      ) : (
        <div className="mt-1 text-center text-sm font-medium text-slate-700">{station.machin_name}</div>
      )}

      <div className="my-2 flex justify-center">
        {isIo ? (
          <div className="flex h-[72px] w-[56px] items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600">
            {variant === "input" ? "IN" : "OUT"}
          </div>
        ) : (
          <OperatorAvatar3D
            status={station.status}
            operatorId={station.operator_id}
            photoUrl={station.operator_photo_url}
          />
        )}
      </div>

      {!isIo ? (
        <div className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1">
          <StationInfo station={station} />
        </div>
      ) : (
        <div className="space-y-1.5 px-2 py-1 text-[11px] text-slate-600">
          <div className="text-center text-slate-500">Line buffer</div>
        </div>
      )}
    </div>
  );
}
