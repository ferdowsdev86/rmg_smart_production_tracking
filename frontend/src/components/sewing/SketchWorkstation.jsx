import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { resolveHrPhotoUrl } from "../../lib/hrPhoto";

function EmployeePhoto({ photoUrl, name, sizeClass, showCross = false, label }) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolved = resolveHrPhotoUrl(photoUrl);
  const showPhoto = Boolean(resolved && !imgFailed);

  useEffect(() => {
    setImgFailed(false);
  }, [resolved]);

  return (
    <div className="flex flex-col items-center gap-0.5" title={label || name}>
      <div className={`relative ${sizeClass}`}>
        {showPhoto ? (
          <div className={`${sizeClass} overflow-hidden rounded-full ring-2 ring-white shadow-md`}>
            <img
              src={resolved}
              alt={name || "Employee"}
              className="h-full w-full object-cover object-top"
              onError={() => setImgFailed(true)}
            />
          </div>
        ) : (
          <div className={`${sizeClass} rounded-full bg-white/25 ring-2 ring-white/70`} aria-hidden />
        )}
        {showCross ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-red-600/55">
            <X className="h-[55%] w-[55%] stroke-[3] text-white drop-shadow" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function getStatusStyles(mismatch, hasPresent) {
  if (mismatch) {
    return {
      card: "border-red-400/70 ring-red-500/90 shadow-[0_4px_16px_rgba(239,68,68,0.2)]",
      railTop: "bg-gradient-to-b from-red-100 to-red-200",
      railMid: "bg-gradient-to-b from-sky-50 to-blue-100",
      railBot: "bg-gradient-to-b from-slate-600 to-slate-800",
      panel: "bg-gradient-to-br from-white via-red-50/30 to-white",
    };
  }
  if (hasPresent) {
    return {
      card: "border-emerald-300/60 ring-emerald-400/90 shadow-[0_4px_16px_rgba(16,185,129,0.18)]",
      railTop: "bg-gradient-to-b from-emerald-100 to-emerald-200",
      railMid: "bg-gradient-to-b from-sky-50 to-blue-100",
      railBot: "bg-gradient-to-b from-blue-600 to-blue-800",
      panel: "bg-gradient-to-br from-white via-emerald-50/40 to-sky-50/50",
    };
  }
  return {
    card: "border-slate-200/80 ring-slate-300/80 shadow-[0_4px_14px_rgba(100,116,139,0.12)]",
    railTop: "bg-gradient-to-b from-slate-200 to-slate-300",
    railMid: "bg-gradient-to-b from-slate-100 to-slate-200",
    railBot: "bg-gradient-to-b from-slate-500 to-slate-600",
    panel: "bg-gradient-to-br from-white to-slate-50",
  };
}

function formatDurationHm(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total <= 0) return "0h 0m";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function productiveTimeDisplay(station) {
  const workingSeconds = Number(station?.working_seconds ?? 0);
  const idleSeconds = Number(station?.idle_seconds ?? 0);
  return formatDurationHm(Math.max(0, workingSeconds - idleSeconds));
}

function employeeDisplayName(station) {
  return (
    station?.present_operator_name ||
    station?.assigned_operator_name ||
    station?.operator_name ||
    "—"
  );
}

function employeeDesignation(station) {
  return (
    station?.present_operator_designation ||
    station?.operator_designation ||
    "—"
  );
}

function MetricRow({ label, value, compact, tabular = true, nowrap = false }) {
  const display = value && value !== "—" ? value : "—";
  return (
    <div
      className={[
        "grid grid-cols-[4.25rem_minmax(0,1fr)] items-center border-b border-slate-200/80 last:border-0",
        compact ? "text-[10px]" : "text-[11px]",
      ].join(" ")}
      title={`${label}: ${display}`}
    >
      <span className="px-1 py-1.5 text-center font-bold uppercase tracking-wide text-slate-600">
        {label}
      </span>
      <span
        className={[
          "border-l border-slate-200/80 px-2 py-1.5 font-extrabold text-slate-900",
          tabular ? "tabular-nums" : "normal-case leading-snug",
          nowrap ? "whitespace-nowrap" : "break-words",
        ].join(" ")}
      >
        {display}
      </span>
    </div>
  );
}

/** Assigned + present employee photos; single photo when both match at this workstation. */
export function SketchWorkstation({ station, overview = false, className = "" }) {
  const compact = overview;
  const mismatch = Boolean(station?.assignment_mismatch);
  const hasPresent = Boolean(station?.has_present_activity);
  const styles = getStatusStyles(mismatch, hasPresent && !mismatch);

  const assignedId = station?.assigned_employee_id || station?.employeeId || "—";
  const presentId = station?.present_employee_id || "—";
  const sameEmployee =
    Boolean(station?.assignment_match) ||
    (hasPresent &&
      assignedId !== "—" &&
      presentId !== "—" &&
      assignedId.toUpperCase() === presentId.toUpperCase());
  const photoSize = compact ? "h-9 w-9" : "h-11 w-11";
  const presentSize = compact ? "h-10 w-10" : "h-14 w-14";
  const railWidth = compact ? "w-[54px]" : "w-[72px]";

  return (
    <div
      className={[
        "flex min-w-0 overflow-hidden rounded-xl border-2 bg-white ring-2 ring-offset-1",
        styles.card,
        className,
      ].join(" ")}
      title={
        mismatch
          ? `Assigned ${assignedId} · Present ${presentId}`
          : [assignedId, station?.in_time, station?.out_time].filter(Boolean).join(" · ")
      }
    >
      <div className={`flex ${railWidth} shrink-0 flex-col shadow-[inset_-1px_0_0_rgba(255,255,255,0.2)]`}>
        {sameEmployee ? (
          <div className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 ${styles.railTop}`}>
            <EmployeePhoto
              photoUrl={station?.present_photo_url || station?.assigned_photo_url}
              name={station?.present_operator_name || station?.assigned_operator_name}
              sizeClass={presentSize}
              label={`${assignedId}`}
            />
            {hasPresent ? (
              <span
                className={[
                  "max-w-full break-all text-center font-bold text-slate-800",
                  compact ? "text-[6px] font-mono leading-tight" : "text-[7px] font-mono",
                ].join(" ")}
              >
                {presentId}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <div className={`flex justify-center py-1.5 ${styles.railTop}`}>
              <EmployeePhoto
                photoUrl={station?.assigned_photo_url}
                name={station?.assigned_operator_name}
                sizeClass={photoSize}
                showCross={mismatch}
                label={`Assigned: ${assignedId}`}
              />
            </div>
            <div className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 ${styles.railMid}`}>
              <EmployeePhoto
                photoUrl={station?.present_photo_url}
                name={station?.present_operator_name}
                sizeClass={presentSize}
                label={hasPresent ? `Present: ${presentId}` : "No activity"}
              />
              {hasPresent ? (
                <span
                  className={[
                    "max-w-full break-all text-center font-bold text-slate-800",
                    compact ? "text-[6px] font-mono leading-tight" : "text-[7px] font-mono",
                  ].join(" ")}
                >
                  {presentId}
                </span>
              ) : null}
            </div>
          </>
        )}
        <div className={`flex min-h-[2rem] items-center justify-center px-0.5 py-1 ${styles.railBot}`}>
          <span
            className={[
              "text-center font-extrabold leading-tight text-white drop-shadow-sm",
              compact ? "break-all text-[6px] font-mono" : "text-[8px] font-mono",
            ].join(" ")}
          >
            {assignedId}
          </span>
        </div>
      </div>

      <div className={`min-w-0 flex-1 ${compact ? "px-1.5 py-1.5" : "min-w-[18rem] px-2 py-2"} ${styles.panel}`}>
        <div className="overflow-hidden rounded-lg border border-slate-300/80 bg-white/90 shadow-sm">
          <MetricRow compact={compact} label="Name" value={employeeDisplayName(station)} tabular={false} nowrap />
          <MetricRow compact={compact} label="Desig" value={employeeDesignation(station)} tabular={false} nowrap />
          <MetricRow compact={compact} label="In Tm" value={hasPresent ? station?.in_time : "—"} />
          <MetricRow compact={compact} label="Out Tm" value={hasPresent ? station?.out_time : "—"} />
          <MetricRow compact={compact} label="WT" value={hasPresent ? station?.working_hour_display : "0h 0m"} />
          <MetricRow
            compact={compact}
            label="NPT"
            value={hasPresent ? station?.non_productive_display : "0h 0m"}
          />
          <MetricRow
            compact={compact}
            label="PT"
            value={hasPresent ? productiveTimeDisplay(station) : "0h 0m"}
          />
        </div>
      </div>
    </div>
  );
}
