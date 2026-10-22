import { RAG_COLORS } from "./config";
import { RagPill } from "./ui";

/** Shift progress bar + single RAG health sentence. */
export default function HealthHero({ shift, health, lastUpdated, stale }) {
  const c = RAG_COLORS[health.overall] || RAG_COLORS.grey;
  const hours = [];
  for (let i = 0; i <= shift.totalHrs; i += 1) hours.push((shift.startH + i) % 24);
  return (
    <div className={`rounded-xl border-l-4 ${c.border} border-y border-r border-slate-200 bg-white p-3 shadow-sm`}>
      <div className="flex flex-wrap items-center gap-3">
        <RagPill rag={health.overall}>{health.label}</RagPill>
        <p className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-slate-800">{health.sentence}</p>
        <span className={`shrink-0 text-[11px] font-semibold ${stale ? "text-rose-600" : "text-slate-400"}`}>
          {stale ? `⚠ stale — last updated ${lastUpdated}s ago` : `updated ${lastUpdated}s ago`}
        </span>
      </div>
      {/* shift progress 08:00 → end with now marker */}
      <div className="mt-2.5">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full" style={{ width: `${shift.pctElapsed}%`, background: c.dot, opacity: 0.85 }} />
          {shift.isToday && shift.pctElapsed > 0 && shift.pctElapsed < 100 ? (
            <div className="absolute top-0 h-full w-0.5 bg-slate-900" style={{ left: `${shift.pctElapsed}%` }} />
          ) : null}
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-semibold tabular-nums text-slate-400">
          {hours.map((h, i) => (
            <span key={i}>{String(h).padStart(2, "0")}</span>
          ))}
        </div>
        <div className="text-right text-[11px] font-semibold text-slate-500">
          {shift.isToday
            ? `${shift.elapsedHrs.toFixed(1)}h of ${shift.totalHrs}h elapsed`
            : "full day (historical)"}
        </div>
      </div>
    </div>
  );
}
