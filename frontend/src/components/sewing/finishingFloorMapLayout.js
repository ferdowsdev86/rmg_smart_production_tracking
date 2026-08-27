/**
 * Finishing line top view: 5 zones × 5 stations (one camera per zone).
 * Workstations are numbered sequentially along the line (workstationId 1…N).
 */
export const STATIONS_PER_ZONE = 5;
export const MAX_FLOOR_MAP_ZONES = 5;

/** Optional top-view position overrides: line_number -> workstationId -> { row, col }. */
export const FLOOR_MAP_POSITIONS = {};

export function resolveZoneNumber(workstationId) {
  const id = Number(workstationId);
  if (!Number.isFinite(id) || id <= 0) return 1;
  return Math.min(MAX_FLOOR_MAP_ZONES, Math.ceil(id / STATIONS_PER_ZONE));
}

/** Line-wide serial (workstationId 1…N along the finishing line). */
export function formatLineStationNo(station) {
  const number = station?.workstationId ?? station?.slotIndex ?? 0;
  return String(number).padStart(2, "0");
}

/** Process-wise serial (stationIndex within each process: 01, 02…). */
export function formatProcessStationNo(station) {
  const number = station?.stationIndex ?? 0;
  return String(number).padStart(2, "0");
}

export function buildFloorMapCells(sections, lineNumber) {
  const overrides = FLOOR_MAP_POSITIONS[lineNumber] ?? {};
  const cells = [];

  (sections ?? []).forEach((section, sectionIndex) => {
    const process = section.process ?? {};
    const processOrder = Number(process.order ?? process.display_order ?? sectionIndex + 1);
    const processName = process.name || process.process_name || `Process ${processOrder}`;
    const stations = section.stations ?? [];

    stations.forEach((station, index) => {
      const workstationId = station.workstationId ?? station.stationIndex;
      const override =
        overrides[workstationId] ??
        overrides[String(workstationId)] ??
        overrides[station.slotId] ??
        null;

      const row = override?.row ?? processOrder;
      const col = override?.col ?? (station.stationIndex ?? index + 1);

      cells.push({
        station,
        process,
        processOrder,
        processName,
        row,
        col,
        zone: resolveZoneNumber(workstationId),
        key: station.slotId ?? `${processOrder}-${workstationId}`,
      });
    });
  });

  const maxRow = cells.reduce((max, cell) => Math.max(max, cell.row), 0);
  const maxCol = cells.reduce((max, cell) => Math.max(max, cell.col), 0);

  return { cells, maxRow: Math.max(maxRow, 1), maxCol: Math.max(maxCol, 1) };
}

/** Group line stations into fixed-size camera zones (5 stations each). */
export function buildFloorMapZones(sections, lineNumber) {
  const { cells } = buildFloorMapCells(sections, lineNumber);
  const ordered = [...cells].sort((a, b) => {
    const wa = Number(a.station.workstationId ?? a.station.slotIndex ?? 0);
    const wb = Number(b.station.workstationId ?? b.station.slotIndex ?? 0);
    return wa - wb;
  });

  const zones = [];
  for (let z = 0; z < MAX_FLOOR_MAP_ZONES; z += 1) {
    const start = z * STATIONS_PER_ZONE;
    const chunk = ordered.slice(start, start + STATIONS_PER_ZONE);
    if (chunk.length === 0 && z > 0) break;
    zones.push({
      zone: z + 1,
      cells: chunk,
      slotCapacity: STATIONS_PER_ZONE,
    });
  }

  const capacity = MAX_FLOOR_MAP_ZONES * STATIONS_PER_ZONE;
  if (ordered.length > capacity && zones.length) {
    const overflow = ordered.slice(capacity);
    zones[zones.length - 1].cells.push(...overflow);
  }

  return zones;
}

export function groupCellsByProcessRow(cells) {
  const rows = new Map();
  for (const cell of cells) {
    if (!rows.has(cell.row)) {
      rows.set(cell.row, {
        row: cell.row,
        processOrder: cell.processOrder,
        processName: cell.processName,
        process: cell.process,
        cells: [],
      });
    }
    rows.get(cell.row).cells.push(cell);
  }
  return [...rows.values()].sort((a, b) => a.row - b.row);
}
