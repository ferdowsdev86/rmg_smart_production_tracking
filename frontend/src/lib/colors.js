export function efficiencyTone(pct) {
  if (pct > 80) return { label: "good", text: "text-emerald-700", bar: "bg-emerald-500", border: "border-l-emerald-500" };
  if (pct >= 60) return { label: "warn", text: "text-amber-700", bar: "bg-amber-500", border: "border-l-amber-500" };
  return { label: "bad", text: "text-red-700", bar: "bg-red-500", border: "border-l-red-500" };
}
