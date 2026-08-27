import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getProcessAccentClass } from "./finishingTheme";
import { buildFloorMapZones, formatLineStationNo, formatProcessStationNo, STATIONS_PER_ZONE } from "./finishingFloorMapLayout";
import {
  buildLineKpis,
  computeZonesStaffing,
  findBottleneck,
  formatMetric,
  isBottleneckStation,
} from "./finishingFloorMapMetrics";
import { FinishingWorkstationHoverCard } from "./FinishingWorkstationHoverCard";
import { computeLineStaffing, rollupZonesStaffing } from "./staffingVariance";
import { computeZoneStationDisplays } from "./stationPresent";
import personDeskIcon from "../../assets/person-desk-icon.png";
import { getStationStatus } from "./stationStatus";

const HOVER_W = 400;
const HOVER_H = 460;
const HOVER_GAP = 10;

function mapStatusTone(variant) {
  switch (variant) {
    case "present":
      return {
        cell: "bg-emerald-500/90 border-emerald-300 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]",
        chip: "bg-emerald-600 text-white",
      };
    case "alert":
    case "idle":
      return {
        cell: "bg-amber-400/95 border-amber-200 text-amber-950 shadow-[0_0_10px_rgba(251,191,36,0.4)]",
        chip: "bg-amber-600 text-white",
      };
    default:
      return {
        cell: "bg-slate-600/80 border-slate-500 text-slate-200",
        chip: "bg-slate-500 text-slate-100",
      };
  }
}

function KpiTile({ label, value, sub, accent = "slate" }) {
  const accents = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/80",
    emerald: "border-emerald-200 bg-emerald-50/80",
    amber: "border-amber-200 bg-amber-50/80",
  };
  return (
    <div className={["rounded-xl border px-3 py-2 shadow-sm", accents[accent] || accents.slate].join(" ")}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{value}</p>
      {sub ? <p className="text-[10px] font-semibold text-slate-500">{sub}</p> : null}
    </div>
  );
}

function StatusLegend() {
  const items = [
    { label: "Present / Working", className: "bg-emerald-500" },
    { label: "Alert / Idle", className: "bg-amber-400" },
    { label: "Empty / Absent", className: "bg-slate-500" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-400">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-sm ${item.className}`} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ZoneManpowerPanel({ staffing }) {
  if (!staffing) return null;
  const balanced = staffing.short === 0 && staffing.excess === 0;

  return (
    <div className="mt-2 space-y-0.5 border-t border-slate-600 pt-1.5 text-left text-[9px] font-bold tabular-nums">
      <div className="flex justify-between gap-2 text-slate-400">
        <span>Required</span>
        <span className="text-white">{staffing.required}</span>
      </div>
      <div className="flex justify-between gap-2 text-slate-400">
        <span>Present</span>
        <span className="text-emerald-300">{staffing.present}</span>
      </div>
      {staffing.short > 0 ? (
        <div className="flex justify-between gap-2 text-amber-300">
          <span>Short</span>
          <span>-{staffing.short}</span>
        </div>
      ) : null}
      {staffing.excess > 0 ? (
        <div className="flex justify-between gap-2 text-orange-300">
          <span>Excess</span>
          <span>+{staffing.excess}</span>
        </div>
      ) : null}
      {balanced ? <p className="pt-0.5 text-center text-emerald-400">Balanced</p> : null}
    </div>
  );
}

function ZoneManpowerSummaryStrip({ zonesStaffing }) {
  if (!zonesStaffing?.length) return null;

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-700 bg-slate-800/60 px-3 py-2 md:grid-cols-5">
      {zonesStaffing.map(({ zone, staffing }) => (
        <div
          key={`zone-mp-${zone}`}
          className="rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-[10px]"
        >
          <p className="font-extrabold uppercase tracking-wide text-sky-300">Zone {zone}</p>
          <p className="mt-0.5 font-bold tabular-nums text-white">
            {staffing.present} / {staffing.required}
            <span className="ml-1 font-semibold text-slate-400">present / req</span>
          </p>
          <p className="mt-0.5 font-bold tabular-nums">
            {staffing.short > 0 ? (
              <span className="text-amber-300">Short {staffing.short}</span>
            ) : null}
            {staffing.short > 0 && staffing.excess > 0 ? (
              <span className="text-slate-500"> · </span>
            ) : null}
            {staffing.excess > 0 ? (
              <span className="text-orange-300">Excess +{staffing.excess}</span>
            ) : null}
            {staffing.short === 0 && staffing.excess === 0 ? (
              <span className="text-emerald-400">Balanced</span>
            ) : null}
          </p>
        </div>
      ))}
    </div>
  );
}

function FloorMapHoverPortal({ anchor, station, cameraPresent, onStayOpen, onRequestClose }) {
  const [position, setPosition] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + HOVER_GAP };
  });

  useEffect(() => {
    const update = () => {
      if (!anchor.isConnected) {
        onRequestClose();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - HOVER_W / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - HOVER_W - 8));
      let top = rect.bottom + HOVER_GAP;
      if (top + HOVER_H > window.innerHeight - 8) top = rect.top - HOVER_H - HOVER_GAP;
      setPosition({ left, top });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor, onRequestClose]);

  return createPortal(
    <div
      className="fixed z-[5000]"
      style={{ left: position.left, top: position.top, width: HOVER_W }}
      onMouseEnter={onStayOpen}
      onMouseLeave={onRequestClose}
    >
      <FinishingWorkstationHoverCard station={station} cameraPresent={cameraPresent} showCamera />
    </div>,
    document.body,
  );
}

function FloorMapExpandedPortal({ station, cameraPresent, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]"
        aria-label="Close workstation detail"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <FinishingWorkstationHoverCard
          station={station}
          cameraPresent={cameraPresent}
          showCamera
          expanded
        />
        <button
          type="button"
          className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-white shadow-lg hover:bg-slate-800"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}

function FloorMapStationCell({ cell, stationDisplay, isBottleneck, onHover, onLeave, onExpand }) {
  const { station, process, processName } = cell;
  const status = getStationStatus(station);
  const accent = getProcessAccentClass(process);
  const lineNo = formatLineStationNo(station);
  const processNo = formatProcessStationNo(station);

  const iconCount = stationDisplay?.iconCount ?? 0;
  const isActive = stationDisplay?.isActive ?? false;
  const statusVariant = isActive
    ? status.variant === "alert"
      ? "alert"
      : "present"
    : status.variant;
  const tone = mapStatusTone(statusVariant);

  return (
    <button
      type="button"
      className={[
        "group relative flex min-h-[5.5rem] w-full min-w-[5rem] flex-col overflow-hidden rounded-lg border-2 text-left transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
        tone.cell,
        isBottleneck ? "ring-2 ring-red-500 ring-offset-2 ring-offset-slate-900" : "",
      ].join(" ")}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      onDoubleClick={(e) => {
        e.preventDefault();
        onExpand?.(cell.station);
      }}
      title={`Stn ${lineNo} · Proc ${processNo} · ${processName} (double-click to expand)`}
    >
      <div className={`h-1 w-full shrink-0 ${accent}`} aria-hidden />
      <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5">
        <div className="flex items-baseline gap-1 leading-none">
          <span className="text-lg font-extrabold tabular-nums">{lineNo}</span>
          <span className="text-[9px] font-bold uppercase tracking-wide opacity-75">Stn</span>
        </div>
        <span className="text-[10px] font-bold tabular-nums leading-none opacity-90">
          P-{processNo}
        </span>
        <span className="line-clamp-1 text-center text-[9px] font-bold uppercase tracking-wide opacity-90">
          {processName}
        </span>
        <div className="relative mt-0.5 flex min-h-[1.75rem] items-end justify-center">
          {iconCount > 0 ? (
            <div
              className="relative"
              style={{
                width: iconCount > 1 ? 36 : 28,
                height: iconCount > 1 ? 34 : 28,
              }}
            >
              {Array.from({ length: iconCount }).map((_, index) => (
                <img
                  key={`desk-${index}`}
                  src={personDeskIcon}
                  alt={iconCount > 1 ? "Additional operator" : "Operator at station"}
                  title={iconCount > 1 && index > 0 ? "Additional zone operator" : "Operator at station"}
                  className="absolute h-7 w-7 object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
                  style={{ left: index * 8, top: index * 5, zIndex: index + 1 }}
                  draggable={false}
                />
              ))}
            </div>
          ) : (
            <span className="h-7 w-7 rounded-full border border-dashed border-white/30" aria-hidden />
          )}
        </div>
      </div>
      {isBottleneck ? (
        <span className="absolute -right-1 -top-1 rounded bg-red-600 px-1 py-0.5 text-[8px] font-extrabold uppercase text-white shadow">
          BN
        </span>
      ) : null}
    </button>
  );
}

export function FinishingFloorMap({
  dashboard,
  activeLine,
  sections,
  lineSummary,
  generatedAt,
}) {
  const lineNumber = activeLine?.line_number ?? 1;
  const lineStaffing = useMemo(() => computeLineStaffing(sections), [sections]);
  const kpis = useMemo(
    () => buildLineKpis({ dashboard, activeLine, sections, lineStaffing }),
    [dashboard, activeLine, sections, lineStaffing],
  );
  const bottleneck = useMemo(() => findBottleneck(sections), [sections]);
  const zonePresentByZone = useMemo(() => {
    const map = new Map();
    for (const item of dashboard?.zone_present ?? []) {
      const zone = Number(item?.zone);
      if (!Number.isFinite(zone) || zone <= 0) continue;
      map.set(zone, Math.max(0, Number(item?.present) || 0));
    }
    return map;
  }, [dashboard?.zone_present]);

  const zoneRows = useMemo(() => buildFloorMapZones(sections, lineNumber), [sections, lineNumber]);
  const zonesStaffing = useMemo(
    () => computeZonesStaffing(sections, lineNumber, zonePresentByZone),
    [sections, lineNumber, zonePresentByZone],
  );
  const layoutManpower = useMemo(() => rollupZonesStaffing(zonesStaffing), [zonesStaffing]);
  const staffingByZone = useMemo(() => {
    const map = new Map();
    for (const item of zonesStaffing) {
      map.set(item.zone, item.staffing);
    }
    return map;
  }, [zonesStaffing]);

  const [hoverTarget, setHoverTarget] = useState(null);
  const [expandedStation, setExpandedStation] = useState(null);
  const hideTimer = useRef(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const openHover = useCallback(
    (anchor, station) => {
      if (expandedStation) return;
      clearHideTimer();
      setHoverTarget({ anchor, station });
    },
    [clearHideTimer, expandedStation],
  );

  const scheduleClose = useCallback(() => {
    if (expandedStation) return;
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => setHoverTarget(null), 120);
  }, [clearHideTimer, expandedStation]);

  const openExpanded = useCallback((station) => {
    clearHideTimer();
    setHoverTarget(null);
    setExpandedStation(station);
  }, [clearHideTimer]);

  const closeExpanded = useCallback(() => {
    setExpandedStation(null);
  }, []);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const lineLabel = activeLine?.display_label || `Line - ${lineNumber}`;
  const cameraPresent = useMemo(() => {
    const zones = dashboard?.zone_present ?? [];
    if (zones.length) {
      return zones.reduce((sum, item) => sum + (Number(item?.present) || 0), 0);
    }
    return lineSummary?.total_present_workers ?? kpis.manpower.present;
  }, [dashboard?.zone_present, lineSummary?.total_present_workers, kpis.manpower.present]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Target (today)" value={formatMetric(kpis.target)} sub="Daily line target" accent="blue" />
        <KpiTile label="Actual (today)" value={formatMetric(kpis.actual)} sub="Units produced" accent="emerald" />
        <KpiTile
          label="Hourly output"
          value={formatMetric(kpis.hourlyOutput, " pcs/hr")}
          sub="Rolling hour"
        />
        <KpiTile
          label="Efficiency"
          value={kpis.efficiencyPct != null ? `${kpis.efficiencyPct}%` : "N/A"}
          sub="Line efficiency"
          accent="amber"
        />
        <KpiTile
          label="Layout manpower"
          value={`${layoutManpower.present} / ${layoutManpower.required}`}
          sub={
            layoutManpower.short > 0 || layoutManpower.excess > 0
              ? `Short ${layoutManpower.short} · Excess +${layoutManpower.excess}`
              : "All zones balanced"
          }
          accent="emerald"
        />
        <KpiTile
          label="On floor (detected)"
          value={String(cameraPresent)}
          sub="Camera / attendance match"
          accent="blue"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-inner">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-4 py-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                Top view · 5 zones × 5 stations
              </p>
              <h2 className="text-lg font-extrabold text-white">{lineLabel}</h2>
            </div>
            {bottleneck ? (
              <div className="rounded-lg border border-red-500/60 bg-red-950/50 px-3 py-1.5 text-xs font-bold text-red-200">
                Bottleneck: {bottleneck.processName} ({bottleneck.present}/{bottleneck.required}{" "}
                staffed)
              </div>
            ) : null}
          </header>

          <ZoneManpowerSummaryStrip zonesStaffing={zonesStaffing} />

          <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-3">
              {zoneRows.map((zoneRow) => {
                const zoneDisplayMap = computeZoneStationDisplays(
                  zoneRow.cells,
                  zonePresentByZone.get(zoneRow.zone),
                );
                const paddedCells = [...zoneRow.cells];
                while (paddedCells.length < STATIONS_PER_ZONE) {
                  paddedCells.push(null);
                }
                const processNames = [
                  ...new Set(zoneRow.cells.map((cell) => cell.processName).filter(Boolean)),
                ];
                return (
                  <div key={`zone-${zoneRow.zone}`} className="flex gap-2">
                    <div className="flex w-36 shrink-0 flex-col justify-center rounded-lg border border-slate-600 bg-slate-800/90 px-2 py-2">
                      <span className="text-center text-[10px] font-bold uppercase tracking-wide text-sky-300">
                        Zone {zoneRow.zone}
                      </span>
                      <span className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Camera {zoneRow.zone}
                      </span>
                      <span className="mt-1 line-clamp-3 text-center text-[10px] font-semibold leading-tight text-slate-300">
                        {processNames.length
                          ? processNames.slice(0, 3).join(" · ")
                          : `${STATIONS_PER_ZONE} stations`}
                      </span>
                      <ZoneManpowerPanel staffing={staffingByZone.get(zoneRow.zone)} />
                    </div>
                    <div
                      className="grid flex-1 gap-2"
                      style={{
                        gridTemplateColumns: `repeat(${STATIONS_PER_ZONE}, minmax(5rem, 1fr))`,
                      }}
                    >
                      {paddedCells.map((cell, index) =>
                        cell ? (
                          <FloorMapStationCell
                            key={cell.key}
                            cell={cell}
                            stationDisplay={zoneDisplayMap.get(cell.key)}
                            isBottleneck={isBottleneckStation(cell.station, bottleneck)}
                            onHover={(e) => openHover(e.currentTarget, cell.station)}
                            onLeave={scheduleClose}
                            onExpand={openExpanded}
                          />
                        ) : (
                          <div
                            key={`zone-${zoneRow.zone}-empty-${index}`}
                            className="min-h-[5.5rem] rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/40"
                            aria-hidden
                          />
                        ),
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-700 px-4 py-2">
            <StatusLegend />
            {generatedAt ? (
              <p className="text-[11px] font-semibold tabular-nums text-slate-400">
                Last updated {new Date(generatedAt).toLocaleString()}
              </p>
            ) : null}
          </footer>
        </section>
      </div>

      {hoverTarget && !expandedStation ? (
        <FloorMapHoverPortal
          anchor={hoverTarget.anchor}
          station={hoverTarget.station}
          cameraPresent={cameraPresent}
          onStayOpen={clearHideTimer}
          onRequestClose={scheduleClose}
        />
      ) : null}

      {expandedStation ? (
        <FloorMapExpandedPortal
          station={expandedStation}
          cameraPresent={cameraPresent}
          onClose={closeExpanded}
        />
      ) : null}
    </div>
  );
}
