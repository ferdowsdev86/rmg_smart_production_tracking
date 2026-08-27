import { useEffect, useMemo, useState } from "react";

import { FinishingFloorMap } from "./FinishingFloorMap";
import { QualityBuyerStrip } from "./QualityBuyerStrip";
import { getProcessAccentClass } from "./finishingTheme";
import {
  computeLineStaffing,
  computeProcessStaffing,
  processCardBorderClasses,
  staffingVarianceBadgeClasses,
  staffingVarianceLabel,
} from "./staffingVariance";
import { WorkstationSlotIcon } from "./WorkstationSlotIcon";

function StaffingVarianceBadge({ staffing }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset",
        staffingVarianceBadgeClasses(staffing.status),
      ].join(" ")}
      title={`Present ${staffing.present} · Required ${staffing.required}`}
    >
      {staffingVarianceLabel(staffing)}
    </span>
  );
}

function LineStaffingSummaryRow({ lineStaffing, prominent = true }) {
  const { totalPresent, totalRequired, overCount, underCount, balancedCount } = lineStaffing;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold shadow-sm"
      aria-label="Line staffing summary"
    >
      <span
        className={[
          "inline-flex items-center gap-1 rounded-md px-2 py-1 tabular-nums text-white shadow-sm",
          prominent ? "bg-orange-500 text-sm font-extrabold" : "bg-orange-400 text-xs font-bold",
        ].join(" ")}
      >
        Over {overCount}
      </span>
      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-bold tabular-nums text-slate-700">
        Present <strong className="text-slate-900">{totalPresent}</strong>
        <span className="text-slate-400"> / </span>
        Req <strong className="text-slate-900">{totalRequired}</strong>
      </span>
      <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-bold tabular-nums text-amber-900">
        Short {underCount}
      </span>
      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-bold tabular-nums text-emerald-800">
        OK {balancedCount}
      </span>
    </div>
  );
}

/** Floor-map preview: Line 1 only until approved for all lines. */
const FLOOR_MAP_PREVIEW_LINE_NUMBER = 1;

const STATIONS_PER_ROW = 2;

function ViewModeToggle({ viewMode, onChange, visible }) {
  if (!visible) return null;

  const base =
    "rounded-full border px-3 py-1 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
  return (
    <nav className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5" aria-label="View mode">
      <button
        type="button"
        onClick={() => onChange("map")}
        className={[
          base,
          viewMode === "map"
            ? "border-blue-700 bg-blue-600 text-white shadow-sm"
            : "border-transparent bg-transparent text-slate-600 hover:text-slate-900",
        ].join(" ")}
      >
        Map
      </button>
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={[
          base,
          viewMode === "grid"
            ? "border-blue-700 bg-blue-600 text-white shadow-sm"
            : "border-transparent bg-transparent text-slate-600 hover:text-slate-900",
        ].join(" ")}
      >
        Grid
      </button>
    </nav>
  );
}

function stationGridCapacity(stationCount) {
  const rows = Math.max(1, Math.ceil(stationCount / STATIONS_PER_ROW));
  return rows * STATIONS_PER_ROW;
}

function EmptyStationSlot() {
  return <div className="h-[5.35rem] w-[4.25rem] justify-self-center" aria-hidden />;
}

function ProcessBlock({ section, overview = false, slotCapacity = STATIONS_PER_ROW }) {
  const { process, stations } = section;
  const processName = process.name || process.process_name || "Process";
  const accentClass = getProcessAccentClass(process);
  const staffing = useMemo(() => computeProcessStaffing(section), [section]);

  const stationSlots = useMemo(() => {
    const items = [...(stations ?? [])];
    while (items.length < slotCapacity) {
      items.push(null);
    }
    return items;
  }, [stations, slotCapacity]);

  const gridRows = Math.max(1, slotCapacity / STATIONS_PER_ROW);

  return (
    <section
      className={[
        "flex h-full min-h-0 flex-col overflow-visible rounded-lg border bg-white shadow-sm",
        processCardBorderClasses(staffing.status),
      ].join(" ")}
    >
      <div className={`h-0.5 shrink-0 rounded-t-lg ${accentClass}`} aria-hidden />
      <header className="grid min-h-[2.85rem] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1.5 gap-y-1 border-b border-slate-100 px-2 py-1.5">
        <h3
          className="line-clamp-2 text-xs font-bold leading-snug text-slate-900"
          title={`${process.order}. ${processName}`}
        >
          <span className="mr-1 tabular-nums font-semibold text-slate-500">{process.order}.</span>
          {processName}
        </h3>
        <StaffingVarianceBadge staffing={staffing} />
      </header>

      <div
        className="grid flex-1 grid-cols-2 justify-items-center gap-x-1 gap-y-1 px-1.5 py-1.5"
        style={{ gridTemplateRows: `repeat(${gridRows}, 5.35rem)` }}
      >
        {stationSlots.map((st, index) =>
          st ? (
            <WorkstationSlotIcon
              key={st.slotId}
              station={st}
              overview={overview}
              compact
              processMeta={{
                machin_type: process.machin_type,
                process_name: processName,
              }}
            />
          ) : (
            <EmptyStationSlot key={`empty-${section.process.id}-${index}`} />
          ),
        )}
      </div>
    </section>
  );
}

function ProcessBoard({ sections, overview = false }) {
  const items = sections ?? [];

  const slotCapacity = useMemo(() => {
    const maxStations = items.reduce((max, section) => Math.max(max, section.stations?.length ?? 0), 0);
    return stationGridCapacity(maxStations);
  }, [items]);

  return (
    <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {items.map((section) => (
        <ProcessBlock
          key={section.process.id}
          section={section}
          overview={overview}
          slotCapacity={slotCapacity}
        />
      ))}
    </div>
  );
}

function LinePicker({ lines, selectedLineId, onSelectLine, compact = false }) {
  if (!lines?.length) return null;

  const showAll = selectedLineId == null;
  const base =
    "rounded-full border font-bold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1";
  const size = compact ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";

  return (
    <nav
      className={["flex flex-wrap items-center", compact ? "gap-1" : "w-full justify-center gap-2"].join(" ")}
      aria-label="Select finishing line"
    >
      <button
        type="button"
        onClick={() => onSelectLine(null)}
        className={[
          base,
          size,
          showAll
            ? "border-blue-700 bg-blue-600 text-white shadow-sm"
            : "border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50",
        ].join(" ")}
      >
        All lines
      </button>
      {lines.map((line) => {
        const active = selectedLineId === line.id;
        return (
          <button
            key={line.id}
            type="button"
            onClick={() => onSelectLine(active ? null : line.id)}
            className={[
              base,
              size,
              active
                ? "border-blue-700 bg-blue-600 text-white shadow-sm"
                : "border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50",
            ].join(" ")}
          >
            {line.display_label || `Line - ${line.line_number}`}
          </button>
        );
      })}
    </nav>
  );
}

function LineSummaryBar({ summary, compact = false }) {
  if (!summary) return null;

  const assigned = summary.total_assigned_workers ?? 0;
  const present = summary.total_present_workers ?? 0;
  const chip = compact
    ? "inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700"
    : "inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm";

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Line summary">
      <span className={chip}>
        <span className="text-slate-500">Asgn</span>
        <span className="font-bold tabular-nums text-slate-900">{assigned}</span>
      </span>
      <span className={chip}>
        <span className="text-slate-500">Pres</span>
        <span className="font-bold tabular-nums text-emerald-700">{present}</span>
      </span>
    </div>
  );
}

function LineSection({ line, sections, lineSummary, overview = false }) {
  const contextLabel = line.display_label || `Line - ${line.line_number}`;
  const lineStaffing = useMemo(() => computeLineStaffing(sections), [sections]);

  return (
    <article className="w-full rounded-lg border border-slate-200 bg-slate-50/80 p-2 shadow-sm">
      <div className="mb-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">{contextLabel}</h2>
          <LineSummaryBar summary={lineSummary} compact />
        </div>
        <LineStaffingSummaryRow lineStaffing={lineStaffing} prominent={false} />
      </div>
      <ProcessBoard sections={sections} overview={overview} />
    </article>
  );
}

function SlimDashboardToolbar({
  dashboard,
  activeLine,
  lineSummary,
  lineStaffing,
  floorStaffing,
  pickerLines,
  selectedLineId,
  onSelectLine,
  floorContextLabel,
  overviewAll = false,
  viewMode,
  onViewModeChange,
  showViewModeToggle = false,
  showQualityStrip = false,
}) {
  const lineLabel = activeLine?.display_label || `Line - ${activeLine?.line_number ?? ""}`;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold text-slate-900">
              Finishing Dashboard — {dashboard.floor?.name ?? floorContextLabel}
            </h1>
            <p className="text-sm font-bold text-slate-600">
              {overviewAll
                ? `${dashboard.line_dashboards?.length ?? 0} lines · ${dashboard.filter_date || "today"}`
                : `${lineLabel} · ${dashboard.filter_date || "today"} · ${dashboard.process_count} processes`}
            </p>
          </div>
          {showQualityStrip ? <QualityBuyerStrip dashboard={dashboard} className="shrink-0" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ViewModeToggle
            visible={showViewModeToggle}
            viewMode={viewMode}
            onChange={onViewModeChange}
          />
          {overviewAll && floorStaffing ? (
            <LineStaffingSummaryRow lineStaffing={floorStaffing} />
          ) : null}
          {!overviewAll && lineStaffing ? <LineStaffingSummaryRow lineStaffing={lineStaffing} /> : null}
          {!overviewAll && lineSummary ? (
            <LineSummaryBar summary={lineSummary} compact />
          ) : null}
          {overviewAll && dashboard.line_summary ? (
            <LineSummaryBar summary={dashboard.line_summary} compact />
          ) : null}
          <LinePicker lines={pickerLines} selectedLineId={selectedLineId} onSelectLine={onSelectLine} compact />
        </div>
      </div>
    </div>
  );
}

export function FinishingDashboard({ dashboard, lines, selectedLineId, onSelectLine, fullPage = false }) {
  if (!dashboard?.floor) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-center text-sm text-amber-900">
        {dashboard?.detail || "Add floors and lines in the database (seed_floor_layout), then refresh."}
      </div>
    );
  }

  const pickerLines = lines ?? dashboard.lines ?? (dashboard.line ? [dashboard.line] : []);
  const showAll = selectedLineId == null;
  const lineDashboards = dashboard.line_dashboards ?? [];
  const overviewAll = fullPage && showAll;
  const singleLine = !showAll;

  const activeBlock = useMemo(() => {
    if (showAll) return null;
    return lineDashboards.find((b) => b.line?.id === selectedLineId) ?? null;
  }, [showAll, lineDashboards, selectedLineId]);

  const sections = showAll ? null : activeBlock?.sections ?? dashboard.sections ?? [];
  const activeLine = showAll ? null : activeBlock?.line ?? dashboard.line;
  const activeLineSummary = showAll ? null : activeBlock?.line_summary ?? dashboard.line_summary ?? null;
  const floorContextLabel = dashboard.floor.display_label || `Floor - ${dashboard.floor.name}`;

  const activeLineStaffing = useMemo(
    () => (singleLine ? computeLineStaffing(sections) : null),
    [singleLine, sections],
  );

  const floorStaffing = useMemo(() => {
    if (!overviewAll) return null;
    const rollup = {
      totalRequired: 0,
      totalPresent: 0,
      overCount: 0,
      underCount: 0,
      balancedCount: 0,
    };
    for (const block of lineDashboards) {
      const ls = computeLineStaffing(block.sections);
      rollup.totalRequired += ls.totalRequired;
      rollup.totalPresent += ls.totalPresent;
      rollup.overCount += ls.overCount;
      rollup.underCount += ls.underCount;
      rollup.balancedCount += ls.balancedCount;
    }
    return rollup;
  }, [overviewAll, lineDashboards]);

  const denseLayout = overviewAll || singleLine;
  const isFloorMapLine =
    singleLine && Number(activeLine?.line_number) === FLOOR_MAP_PREVIEW_LINE_NUMBER;
  const [viewMode, setViewMode] = useState("map");

  useEffect(() => {
    if (isFloorMapLine) {
      setViewMode("map");
    } else {
      setViewMode("grid");
    }
  }, [isFloorMapLine, selectedLineId]);

  const floorMapDashboard = useMemo(() => {
    if (activeBlock?.zone_present?.length) {
      return { ...dashboard, zone_present: activeBlock.zone_present };
    }
    return dashboard;
  }, [dashboard, activeBlock]);

  return (
    <div className={overviewAll ? "flex h-full min-h-0 w-full flex-col" : "w-full"}>
      <div className={["flex w-full flex-col", denseLayout ? "h-full min-h-0" : ""].join(" ")}>
        {denseLayout ? (
          <SlimDashboardToolbar
            dashboard={dashboard}
            activeLine={activeLine}
            lineSummary={activeLineSummary}
            lineStaffing={activeLineStaffing}
            floorStaffing={floorStaffing}
            pickerLines={pickerLines}
            selectedLineId={selectedLineId}
            onSelectLine={onSelectLine}
            floorContextLabel={floorContextLabel}
            overviewAll={overviewAll}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showViewModeToggle={isFloorMapLine}
            showQualityStrip={isFloorMapLine && viewMode === "map"}
          />
        ) : (
          <header className="w-full shrink-0 pb-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">RMG Finishing Floor</p>
            <h1 className="mt-1 text-xl font-extrabold uppercase tracking-wide text-slate-900 md:text-2xl">
              {dashboard.title || "FINISHING-DASHBOARD"}
            </h1>
            <p className="mt-1 text-base font-semibold text-slate-700">{floorContextLabel}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <LinePicker lines={pickerLines} selectedLineId={selectedLineId} onSelectLine={onSelectLine} />
              <ViewModeToggle
                visible={isFloorMapLine}
                viewMode={viewMode}
                onChange={setViewMode}
              />
            </div>
          </header>
        )}

        <div
          className={[
            denseLayout ? "min-h-0 flex-1 overflow-y-auto bg-slate-100 px-2 py-2" : "mt-4 px-2",
          ].join(" ")}
        >
          {showAll ? (
            <div className="grid w-full grid-cols-1 gap-2 xl:grid-cols-2">
              {lineDashboards.map((block) => (
                <LineSection
                  key={block.line.id}
                  line={block.line}
                  sections={block.sections}
                  lineSummary={block.line_summary}
                  overview={overviewAll}
                />
              ))}
              {lineDashboards.length === 0 ? (
                <p className="text-center text-sm text-slate-600">No lines on this floor.</p>
              ) : null}
            </div>
          ) : isFloorMapLine && viewMode === "map" ? (
            <div className="min-h-[calc(100vh-12rem)] px-1 pb-2">
              <FinishingFloorMap
                dashboard={floorMapDashboard}
                activeLine={activeLine}
                sections={sections}
                lineSummary={activeLineSummary}
                generatedAt={dashboard.generated_at}
              />
            </div>
          ) : (
            <div className="px-1 pb-2">
              <ProcessBoard sections={sections} overview={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
