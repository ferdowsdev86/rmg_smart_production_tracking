/** Presentation-only staffing variance from existing dashboard section data. */

import { STATIONS_PER_ZONE } from "./finishingFloorMapLayout";
import { buildPresentEmployees, computeZonePresentFromCells } from "./stationPresent";

export function getProcessRequired(process, stations) {
  const stationsList = stations ?? [];
  const explicit =
    process?.required_manpower ??
    process?.required_headcount ??
    process?.standard_manpower ??
    process?.required ??
    null;
  if (explicit != null && Number(explicit) > 0) {
    return Number(explicit);
  }
  const fromProcess = Number(process?.stationCount ?? process?.station_count ?? 0);
  if (fromProcess > 0) return fromProcess;
  return stationsList.length;
}

export function countPresentAtStation(station) {
  if (station?.present_employees?.length) {
    return station.present_employees.length;
  }
  if (station?.present_count != null) {
    return Number(station.present_count) || 0;
  }
  return buildPresentEmployees(station).length;
}

export function countPresentInSection(section) {
  return (section?.stations ?? []).reduce((sum, station) => sum + countPresentAtStation(station), 0);
}

export function computeProcessStaffing(section) {
  const stations = section?.stations ?? [];
  const required = getProcessRequired(section?.process, stations);
  const present = countPresentInSection(section);
  const delta = present - required;

  let status = "balanced";
  if (delta > 0) status = "over";
  if (delta < 0) status = "under";

  return { required, present, delta, status };
}

export function computeLineStaffing(sections) {
  const items = (sections ?? []).map((section) => ({
    section,
    staffing: computeProcessStaffing(section),
  }));

  let totalRequired = 0;
  let totalPresent = 0;
  let overCount = 0;
  let underCount = 0;
  let balancedCount = 0;

  for (const { staffing } of items) {
    totalRequired += staffing.required;
    totalPresent += staffing.present;
    if (staffing.status === "over") overCount += 1;
    else if (staffing.status === "under") underCount += 1;
    else balancedCount += 1;
  }

  return {
    processes: items,
    totalRequired,
    totalPresent,
    overCount,
    underCount,
    balancedCount,
  };
}

/** Headcount variance for a layout zone (one camera, unique people in zone). */
export function computeZoneStaffing(cells, zonePresentCount = null) {
  const zoneCells = cells ?? [];
  const required = Math.min(zoneCells.length, STATIONS_PER_ZONE);
  const present =
    zonePresentCount != null && !Number.isNaN(Number(zonePresentCount))
      ? Math.max(0, Number(zonePresentCount))
      : computeZonePresentFromCells(zoneCells);
  const delta = present - required;
  let status = "balanced";
  if (delta > 0) status = "over";
  if (delta < 0) status = "under";

  return {
    required,
    present,
    delta,
    short: Math.max(0, required - present),
    excess: Math.max(0, present - required),
    status,
  };
}

export function rollupZonesStaffing(zonesStaffing) {
  return (zonesStaffing ?? []).reduce(
    (acc, item) => {
      acc.required += item.staffing.required;
      acc.present += item.staffing.present;
      acc.short += item.staffing.short;
      acc.excess += item.staffing.excess;
      return acc;
    },
    { required: 0, present: 0, short: 0, excess: 0 },
  );
}

export function processCardBorderClasses(status) {
  if (status === "over") return "border-orange-200 border-l-4 border-l-orange-500";
  if (status === "under") return "border-amber-200 border-l-4 border-l-amber-400";
  return "border-slate-200 border-l-4 border-l-emerald-400";
}

export function staffingVarianceBadgeClasses(status) {
  switch (status) {
    case "over":
      return "bg-orange-100 text-orange-900 ring-orange-300";
    case "under":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    default:
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }
}

export function staffingVarianceLabel(staffing) {
  const { present, required, delta, status } = staffing;
  if (status === "over") {
    return `${present} / ${required}  +${delta} over`;
  }
  if (status === "under") {
    return `${present} / ${required}  ${delta} short`;
  }
  return `${present} / ${required}  OK`;
}
