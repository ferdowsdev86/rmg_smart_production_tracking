/** Present-employee helpers shared by grid and floor-map views. */

import { STATIONS_PER_ZONE } from "./finishingFloorMapLayout";

export function buildPresentEmployees(station) {
  if (station?.present_employees?.length) {
    return station.present_employees;
  }
  if (station?.has_present_activity && station?.present_employee_id) {
    return [station];
  }
  return [];
}

export function employeeInitials(employee) {
  const name = (
    employee?.present_operator_name ||
    employee?.assigned_operator_name ||
    employee?.operator_name ||
    ""
  ).trim();
  if (name && name !== "—") {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  const id = (employee?.present_employee_id || employee?.employeeId || "").trim();
  return id ? id.slice(-2).toUpperCase() : "";
}

function employeeId(emp) {
  return (
    emp?.present_employee_id ||
    emp?.event_employee_id ||
    emp?.employee_id ||
    ""
  )
    .trim()
    .toUpperCase();
}

/** True when employee is still on the floor (open camera session). */
export function isCurrentlyPresent(employee) {
  if (employee?.currently_present === false) return false;
  if (employee?.currently_present === true) return true;
  return true;
}

/** True when camera_data matched this workstation (not assignment fallback elsewhere). */
export function isCameraAtWorkstation(employee) {
  if (employee?.camera_at_workstation === false) return false;
  if (employee?.camera_at_workstation === true) return true;
  // Legacy rows before camera_at_workstation existed: keep prior behaviour.
  return true;
}

/**
 * Unique people detected by the zone camera.
 * Only counts employees with camera_data at a workstation in this zone —
 * not assignment fallbacks that copy line activity onto empty stations.
 */
export function computeUniqueZonePresentCount(zoneCells) {
  const cells = zoneCells ?? [];
  const seen = new Set();
  let hasExplicitCameraFlag = false;
  const perStationGroups = cells.map((cell) => {
    const ids = new Set();
    const station = cell?.station;
    if (!station) return ids;
    for (const emp of station.present_employees ?? []) {
      if (emp.camera_at_workstation != null) hasExplicitCameraFlag = true;
      if (emp.currently_present != null) hasExplicitCameraFlag = true;
      if (!isCameraAtWorkstation(emp)) continue;
      if (!isCurrentlyPresent(emp)) continue;
      const id = employeeId(emp);
      if (id) ids.add(id);
    }
    return ids;
  });

  for (const ids of perStationGroups) {
    for (const id of ids) seen.add(id);
  }

  if (hasExplicitCameraFlag || seen.size === 0) {
    return seen.size;
  }

  // Legacy API rows (no camera_at_workstation): one workstation often holds every
  // zone detect; other stations inflate the union via assignment fallback.
  const sizes = perStationGroups.map((ids) => ids.size);
  const maxAtStation = Math.max(0, ...sizes);
  const topCount = sizes.filter((size) => size === maxAtStation).length;
  if (maxAtStation >= 2 && seen.size > maxAtStation && topCount === 1) {
    return maxAtStation;
  }

  return seen.size;
}

/** Station index (0-based within zone) that shows a double icon when zone is over capacity. */
const ZONE_DOUBLE_ICON_STATION_INDEX = 1;

/**
 * Distribute zone camera headcount across station slots:
 * - 4 people → stations 1–4 green, 1 icon each; station 5 empty
 * - 5 people → all 5 green, 1 icon each
 * - 6+ people → all 5 green; one station (default #2) shows double icon
 */
export function computeZoneStationDisplays(zoneCells, zonePresentCount = null) {
  const cells = zoneCells ?? [];
  const slotCount = Math.min(cells.length, STATIONS_PER_ZONE);
  const zoneCount =
    zonePresentCount != null && !Number.isNaN(Number(zonePresentCount))
      ? Math.max(0, Number(zonePresentCount))
      : computeUniqueZonePresentCount(cells);
  const filledSlots = Math.min(zoneCount, slotCount);
  const hasDoubleIcon = zoneCount > slotCount;

  const displays = cells.map((cell) => ({
    cellKey: cell.key,
    cell,
    iconCount: 0,
    isActive: false,
    zonePresentCount: zoneCount,
  }));

  for (let index = 0; index < filledSlots; index += 1) {
    displays[index].iconCount = 1;
    displays[index].isActive = true;
  }

  if (hasDoubleIcon && filledSlots > 0) {
    const doubleIndex = Math.min(ZONE_DOUBLE_ICON_STATION_INDEX, filledSlots - 1);
    displays[doubleIndex].iconCount = 2;
  }

  return new Map(displays.map((item) => [item.cellKey, item]));
}

export function computeZonePresentFromCells(zoneCells) {
  return computeUniqueZonePresentCount(zoneCells);
}
