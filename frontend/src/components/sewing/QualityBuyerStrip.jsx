import { buildQualityMetrics, formatMetric } from "./finishingFloorMapMetrics";

export function QualityBuyerStrip({ dashboard, className = "" }) {
  const quality = buildQualityMetrics(dashboard);

  const items = [
    ["DHU", formatMetric(quality.dhu)],
    ["Pass rate", quality.passRate != null ? `${quality.passRate}%` : "N/A"],
    ["Reject rate", quality.rejectRate != null ? `${quality.rejectRate}%` : "N/A"],
    ["Rework", formatMetric(quality.rework)],
  ];

  return (
    <div
      className={[
        "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm",
        className,
      ].join(" ")}
    >
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
        Quality (buyer view)
      </p>
      <dl className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5 text-sm">
            <dt className="font-semibold text-slate-600">{label}</dt>
            <dd className="font-extrabold tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
