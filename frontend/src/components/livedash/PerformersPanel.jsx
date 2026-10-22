import { useMemo } from "react";

import { Panel, Spark } from "./ui";

function Row({ m, good }) {
  const initial = (m.operator || `M${m.mid}`).charAt(0);
  return (
    <li className={`flex items-center gap-2 rounded-lg px-2 py-1 ${good ? "bg-emerald-50/70" : "bg-rose-50/70"}`}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white ${good ? "bg-emerald-500" : "bg-rose-500"}`}>{initial}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-bold text-slate-800">{m.operator || "Unknown operator"}</span>
        <span className={`block text-[10px] font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
          M{m.mid} · {m.total} pcs · {m.machineHourTarget ? `${Math.round(m.eff)}% eff` : "—"}{m.defect ? ` · ${m.defect} def` : ""}
        </span>
      </span>
      <Spark values={m.spark} width={44} height={14} />
    </li>
  );
}

export default function PerformersPanel({ mach }) {
  const { top, attention } = useMemo(() => {
    const started = mach.machines.filter((m) => m.total > 0);
    const top5 = [...started].filter((m) => m.defect === 0).sort((a, b) => b.total - a.total).slice(0, 5);
    const bad = [...mach.machines]
      .map((m) => ({ m, score: (m.status === "notstarted" ? 3 : m.status === "down" ? 3 : m.status === "idle" ? 2 : m.status === "slow" ? 1 : 0) * 1000 + m.defect * 100 - m.total }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.m)
      .filter((m) => m.status !== "running" || m.defect > 0);
    return { top: top5, attention: bad };
  }, [mach.machines]);

  return (
    <Panel title="People — Top & Needs Attention">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">★ Top 5</div>
          <ul className="space-y-1">{top.length ? top.map((m) => <Row key={m.mid} m={m} good />) : <li className="text-[11px] text-slate-400">No defect-free output yet.</li>}</ul>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-rose-600">⚠ Needs attention 5</div>
          <ul className="space-y-1">{attention.length ? attention.map((m) => <Row key={m.mid} m={m} />) : <li className="text-[11px] text-slate-400">Nothing flagged.</li>}</ul>
        </div>
      </div>
    </Panel>
  );
}
