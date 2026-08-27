import { useEffect, useState } from "react";
import { Camera, X } from "lucide-react";

import { resolveHrPhotoUrl } from "../../lib/hrPhoto";
import CameraLivePanel from "./CameraLivePanel";
import { resolveZoneNumber, formatLineStationNo, formatProcessStationNo } from "./finishingFloorMapLayout";
import { StationTrafficLight } from "./StationTrafficLight";

/** Merge base workstation slot with a single present-employee metrics row. */
export function mergeStationEmployeeMetrics(station, employeeMetrics) {
  if (!employeeMetrics || employeeMetrics === station) {
    return station;
  }

  return {
    ...station,
    ...employeeMetrics,
    workstationId: station.workstationId,
    workstationCode: station.workstationCode,
    stationIndex: station.stationIndex,
    slotId: station.slotId,
    processId: station.processId,
    employeeId: station.employeeId,
    assigned_employee_id:
      station.assigned_employee_id ?? station.employeeId ?? employeeMetrics.assigned_employee_id,
    assigned_photo_url: station.assigned_photo_url ?? employeeMetrics.assigned_photo_url,
    assigned_operator_name: station.assigned_operator_name ?? employeeMetrics.assigned_operator_name,
    present_employee_id:
      employeeMetrics.present_employee_id ??
      employeeMetrics.event_employee_id ??
      station.present_employee_id,
    present_photo_url: employeeMetrics.present_photo_url ?? station.present_photo_url,
    present_operator_name: employeeMetrics.present_operator_name ?? station.present_operator_name,
    present_operator_designation:
      employeeMetrics.present_operator_designation ?? station.present_operator_designation,
    has_present_activity:
      employeeMetrics.has_present_activity ?? Boolean(employeeMetrics.present_employee_id),
    assignment_match: employeeMetrics.assignment_match ?? station.assignment_match,
    assignment_mismatch: employeeMetrics.assignment_mismatch ?? station.assignment_mismatch,
    in_time: employeeMetrics.in_time ?? station.in_time,
    out_time: employeeMetrics.out_time ?? station.out_time,
    working_hour_display: employeeMetrics.working_hour_display ?? station.working_hour_display,
    non_productive_display: employeeMetrics.non_productive_display ?? station.non_productive_display,
    working_seconds: employeeMetrics.working_seconds ?? station.working_seconds,
    idle_seconds: employeeMetrics.idle_seconds ?? station.idle_seconds,
  };
}

function getStatusStyles(mismatch, hasPresent) {
  if (mismatch) {
    return {
      card: "border-red-300/70 ring-red-400/90",
      railTop: "bg-gradient-to-b from-red-100 to-red-200",
      railMid: "bg-gradient-to-b from-sky-50 to-blue-100",
      railBot: "bg-gradient-to-b from-slate-600 to-slate-800",
      panel: "bg-gradient-to-br from-white via-red-50/25 to-white",
    };
  }
  if (hasPresent) {
    return {
      card: "border-emerald-300/70 ring-emerald-400/90",
      railTop: "bg-gradient-to-b from-emerald-100 to-emerald-200",
      railMid: "bg-gradient-to-b from-sky-50 to-blue-100",
      railBot: "bg-gradient-to-b from-blue-600 to-blue-800",
      panel: "bg-gradient-to-br from-white via-emerald-50/35 to-sky-50/40",
    };
  }
  return {
    card: "border-slate-200/80 ring-slate-300/80",
    railTop: "bg-gradient-to-b from-slate-200 to-slate-300",
    railMid: "bg-gradient-to-b from-slate-100 to-slate-200",
    railBot: "bg-gradient-to-b from-slate-500 to-slate-600",
    panel: "bg-gradient-to-br from-white to-slate-50",
  };
}

function pickValue(...values) {
  for (const value of values) {
    const text = (value ?? "").toString().trim();
    if (text && text !== "—") return text;
  }
  return "—";
}

/** Prefer present (camera) identity once it arrives; otherwise show the assigned operator. */
function employeeDisplayName(station, hasPresent) {
  if (hasPresent) {
    return pickValue(
      station?.present_operator_name,
      station?.assigned_operator_name,
      station?.operator_name,
      station?.present_employee_id,
      station?.assigned_employee_id,
      station?.employeeId,
    );
  }
  return pickValue(
    station?.assigned_operator_name,
    station?.operator_name,
    station?.assigned_employee_id,
    station?.employeeId,
  );
}

function employeeDesignation(station, hasPresent) {
  if (hasPresent) {
    return pickValue(
      station?.present_operator_designation,
      station?.operator_designation,
      station?.assigned_operator_designation,
    );
  }
  return pickValue(
    station?.assigned_operator_designation,
    station?.operator_designation,
  );
}

function SketchField({ label, value, nowrap = false, expanded = false }) {
  const display = value && value !== "—" ? value : "—";
  return (
    <p
      className={[
        expanded ? "text-base leading-snug" : "text-[12px] leading-snug",
        "text-slate-600",
        nowrap ? "flex min-w-0 items-baseline overflow-hidden" : "",
      ].join(" ")}
      title={nowrap ? display : undefined}
    >
      <span className="shrink-0 font-semibold">{label}</span>
      <span className="mx-0.5 shrink-0">=</span>
      <span
        className={[
          "font-bold text-slate-900",
          nowrap ? "min-w-0 truncate whitespace-nowrap" : "",
        ].join(" ")}
      >
        {display}
      </span>
    </p>
  );
}

function MetricRow({ label, value, expanded = false }) {
  const display = value && value !== "—" ? value : "—";
  return (
    <div
      className={[
        "grid items-center border-b border-slate-200/80 last:border-0",
        expanded
          ? "grid-cols-[4.5rem_minmax(0,1fr)] text-sm"
          : "grid-cols-[3.25rem_minmax(0,1fr)] text-[11px]",
      ].join(" ")}
      title={`${label}: ${display}`}
    >
      <span className="px-1 py-1.5 text-center font-bold uppercase tracking-wide text-slate-600">
        {label}
      </span>
      <span className="border-l border-slate-200/80 px-2 py-1.5 text-right font-extrabold tabular-nums text-slate-900">
        {display}
      </span>
    </div>
  );
}

function EmployeePhoto({ photoUrl, name, showCross = false, expanded = false }) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolved = resolveHrPhotoUrl(photoUrl);
  const showPhoto = Boolean(resolved && !imgFailed);
  const sizeClass = expanded ? "h-28 w-28" : "h-14 w-14";

  useEffect(() => {
    setImgFailed(false);
  }, [resolved]);

  return (
    <div className={`relative ${sizeClass}`}>
      {showPhoto ? (
        <div className={`${sizeClass} overflow-hidden rounded-full ring-[3px] ring-white shadow-md`}>
          <img
            src={resolved}
            alt={name || "Employee"}
            className="h-full w-full object-cover object-top"
            onError={() => setImgFailed(true)}
          />
        </div>
      ) : (
        <div className={`${sizeClass} rounded-full bg-slate-200 ring-[3px] ring-white shadow-md`} aria-hidden />
      )}
      {showCross ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-red-600/55">
          <X className={expanded ? "h-12 w-12 stroke-[3] text-white drop-shadow" : "h-7 w-7 stroke-[3] text-white drop-shadow"} />
        </div>
      ) : null}
    </div>
  );
}

export function FinishingWorkstationHoverCard({
  station,
  cameraPresent = 0,
  showCamera = false,
  expanded = false,
}) {
  const hasPresent = Boolean(station?.has_present_activity);

  const assignedId = station?.assigned_employee_id || station?.employeeId || "—";
  const presentId = station?.present_employee_id || "—";
  const sameEmployee =
    Boolean(station?.assignment_match) ||
    (hasPresent &&
      assignedId !== "—" &&
      presentId !== "—" &&
      assignedId.toUpperCase() === presentId.toUpperCase());

  // Only flag a mismatch once camera_data reports a (different) present operator.
  // Until then we show the assigned operator cleanly, with no red cross/styling.
  const mismatch = hasPresent && Boolean(station?.assignment_mismatch) && !sameEmployee;
  const styles = getStatusStyles(mismatch, hasPresent && !mismatch);
  const trafficActive = hasPresent;
  const problemRed = mismatch;

  const photoUrl =
    hasPresent && !sameEmployee
      ? station?.present_photo_url || station?.assigned_photo_url
      : station?.assigned_photo_url;
  const railId = hasPresent && !sameEmployee ? presentId : assignedId;

  const railWidth = expanded ? "w-[8.5rem]" : "w-[5.5rem]";
  const cardWidth = expanded
    ? "w-[min(50rem,calc(100vw-2rem))]"
    : "w-[min(25rem,calc(100vw-1rem))]";
  const cameraZone = resolveZoneNumber(station?.workstationId ?? station?.stationIndex);

  return (
    <div
      className={[
        "pointer-events-auto flex flex-col overflow-hidden rounded-2xl border-2 bg-white shadow-2xl ring-2 ring-offset-1",
        cardWidth,
        styles.card,
      ].join(" ")}
    >
      <div className="flex min-w-0">
        <div className={`flex ${railWidth} shrink-0 flex-col shadow-[inset_-1px_0_0_rgba(255,255,255,0.2)]`}>
          <div className={`flex justify-center py-2 ${styles.railTop}`}>
            <StationTrafficLight active={trafficActive} isRed={problemRed} fullHeight={expanded} />
          </div>
          <div className={`flex flex-1 items-center justify-center py-2 ${styles.railMid}`}>
            <EmployeePhoto
              photoUrl={photoUrl}
              name={employeeDisplayName(station, hasPresent)}
              showCross={mismatch}
              expanded={expanded}
            />
          </div>
          <div className={`flex min-h-[2.25rem] items-center justify-center px-1 py-1.5 ${styles.railBot}`}>
            <span
              className={[
                "break-all text-center font-extrabold leading-tight text-white",
                expanded ? "text-[10px]" : "text-[8px]",
              ].join(" ")}
            >
              {railId}
            </span>
          </div>
        </div>

        <div className={`min-w-0 flex-1 ${expanded ? "px-5 py-4" : "px-3 py-2.5"} ${styles.panel}`}>
          <div className="space-y-1 border-b border-blue-200/70 pb-2">
            <SketchField label="Stn" value={formatLineStationNo(station)} expanded={expanded} />
            <SketchField label="Proc stn" value={formatProcessStationNo(station)} expanded={expanded} />
            <SketchField label="User name" value={employeeDisplayName(station, hasPresent)} nowrap expanded={expanded} />
            <SketchField label="Designation" value={employeeDesignation(station, hasPresent)} nowrap expanded={expanded} />
          </div>

          <div className="mt-2 overflow-hidden rounded-lg border border-slate-300/80 bg-white/95 shadow-sm">
            <MetricRow label="In Tm" value={hasPresent ? station?.in_time : "—"} expanded={expanded} />
            <MetricRow label="Out Tm" value={hasPresent ? station?.out_time : "—"} expanded={expanded} />
            <MetricRow label="WT" value={hasPresent ? station?.working_hour_display : "0h 0m"} expanded={expanded} />
            <MetricRow label="NPT" value={hasPresent ? station?.non_productive_display : "0h 0m"} expanded={expanded} />
          </div>
        </div>
      </div>

      {showCamera ? (
        <div className="border-t border-slate-200 bg-slate-950 px-2 pb-2 pt-1.5">
          <div
            className={[
              "mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-400",
              expanded ? "text-xs" : "text-[10px]",
            ].join(" ")}
          >
            <Camera className={expanded ? "h-4 w-4" : "h-3.5 w-3.5"} />
            Live camera · Zone {cameraZone}
          </div>
          <CameraLivePanel
            compact={!expanded}
            dashboardPresent={cameraPresent}
            stationId={station?.workstationId ?? null}
            stationNo={station?.stationIndex ?? station?.workstationId ?? null}
            zone={cameraZone}
            personLabel={employeeDisplayName(station, hasPresent)}
            personId={
              station?.present_employee_id ||
              station?.assigned_employee_id ||
              station?.employeeId ||
              ""
            }
            className={expanded ? "h-[22rem]" : "h-36"}
          />
        </div>
      ) : null}
    </div>
  );
}
