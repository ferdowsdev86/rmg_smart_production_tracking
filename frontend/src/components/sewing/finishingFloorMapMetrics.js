import { computeLineStaffing, computeProcessStaffing, computeZoneStaffing } from "./staffingVariance";
import { buildFloorMapZones } from "./finishingFloorMapLayout";

export function buildLineKpis({ dashboard, activeLine, sections, lineStaffing }) {
  const target = activeLine?.daily_target;
  const present = lineStaffing?.totalPresent ?? 0;
  const required = lineStaffing?.totalRequired ?? 0;

  return {
    target: target != null && target > 0 ? target : null,
    actual: dashboard?.actual_today ?? dashboard?.line_actual ?? null,
    hourlyOutput: dashboard?.hourly_output ?? dashboard?.pcs_per_hour ?? null,
    efficiencyPct: dashboard?.efficiency_pct ?? dashboard?.line_efficiency_pct ?? null,
    manpower: {
      present,
      required,
      over: lineStaffing?.overCount ?? 0,
      short: lineStaffing?.underCount ?? 0,
      ok: lineStaffing?.balancedCount ?? 0,
    },
  };
}

export function buildQualityMetrics(dashboard) {
  return {
    dhu: dashboard?.dhu ?? dashboard?.quality?.dhu ?? null,
    passRate: dashboard?.pass_rate ?? dashboard?.quality?.pass_rate ?? null,
    rejectRate: dashboard?.reject_rate ?? dashboard?.quality?.reject_rate ?? null,
    rework: dashboard?.rework_count ?? dashboard?.quality?.rework ?? null,
  };
}

export function computeZonesStaffing(sections, lineNumber, zonePresentByZone = null) {
  return buildFloorMapZones(sections, lineNumber).map((zoneRow) => {
    const apiPresent = zonePresentByZone?.get?.(zoneRow.zone);
    return {
      zone: zoneRow.zone,
      staffing: computeZoneStaffing(zoneRow.cells, apiPresent),
      cells: zoneRow.cells,
    };
  });
}

export function findBottleneck(sections) {
  const lineStaffing = computeLineStaffing(sections);
  const understaffed = lineStaffing.processes
    .filter(({ staffing }) => staffing.status === "under")
    .sort((a, b) => a.staffing.delta - b.staffing.delta);

  if (!understaffed.length) return null;

  const worst = understaffed[0];
  const process = worst.section?.process ?? {};
  return {
    processId: process.id,
    processOrder: process.order ?? process.display_order,
    processName: process.name || process.process_name || "Process",
    delta: worst.staffing.delta,
    present: worst.staffing.present,
    required: worst.staffing.required,
    section: worst.section,
  };
}

export function isBottleneckStation(station, bottleneck) {
  if (!bottleneck?.section?.stations) return false;
  return bottleneck.section.stations.some((st) => st.slotId === station.slotId);
}

export function formatMetric(value, suffix = "") {
  if (value == null || value === "" || Number.isNaN(value)) return "N/A";
  return `${value}${suffix}`;
}
