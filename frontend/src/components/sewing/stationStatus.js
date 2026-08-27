/** Visual status for a finishing station — presentation only, no logic changes. */

export function getStationStatus(station) {
  const hasPresent = Boolean(
    station?.has_present_activity ||
      station?.present_employees?.length ||
      station?.present_employee_id,
  );
  const hasAssigned = Boolean(station?.employeeId || station?.assigned_employee_id);
  const mismatch = Boolean(station?.assignment_mismatch);

  if (hasPresent && mismatch) {
    return { label: "Alert", variant: "alert" };
  }
  if (hasPresent) {
    return { label: "Present", variant: "present" };
  }
  if (hasAssigned) {
    return { label: "Idle", variant: "idle" };
  }
  return { label: "Absent", variant: "empty" };
}

export function stationStatusClasses(variant) {
  switch (variant) {
    case "present":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "alert":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "idle":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    default:
      return "bg-transparent text-slate-400/70 ring-transparent";
  }
}

export function stationStatusDot(variant) {
  switch (variant) {
    case "present":
      return "text-emerald-500";
    case "alert":
      return "text-amber-500";
    case "idle":
      return "text-sky-500";
    default:
      return "text-slate-300";
  }
}
