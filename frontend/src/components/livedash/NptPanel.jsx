import { useEffect, useState } from "react";

import { hhmm, minutesSince } from "./derive";
import { Panel, fmt } from "./ui";

export default function NptPanel({ D }) {
  const npt = D.npt || {};
  const cats = npt.categories || [];
  const maxMin = Math.max(...cats.map((c) => c.minutes), 1);
  const running = (npt.rows || []).filter((r) => r.is_open);
  const topMachines = (npt.machines || []).slice(0, 5);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running.length) return undefined;
    const t = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [running.length]);

  return (
    <Panel
      id="sec-npt"
      title="NPT — Non Productive Time"
      right={<span className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${npt.total_minutes > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>Total {hhmm(npt.total_minutes || 0)} · {npt.events ?? 0} events</span>}
    >
      {running.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {running.map((r, i) => {
            const mins = minutesSince(r.start_at);
            const secs = Math.max(0, Math.floor((Date.now() / 1000) % 60));
            return (
              <span key={i} className={`inline-flex animate-pulse items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${mins > 15 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                ⏱ M{r.machin_id} · {r.category} · {String(Math.floor(mins / 60)).padStart(2, "0")}:{String(mins % 60).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </span>
            );
          })}
        </div>
      ) : null}
      {cats.length ? (
        <div className="space-y-1.5">
          {cats.map((c) => (
            <div key={c.category}>
              <div className="flex justify-between text-[11px]">
                <span className="font-semibold text-slate-600">{c.category}</span>
                <b className="tabular-nums text-slate-800">{hhmm(c.minutes)} · {c.events ?? 0} ev</b>
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-violet-500" style={{ width: `${(c.minutes / maxMin) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">✓ No NPT today — full time productive.</div>
      )}
      {topMachines.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">By machine:</span>
          {topMachines.map((m) => (
            <span key={m.machin_id} className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-bold text-violet-700">M{m.machin_id} · {fmt(m.minutes)}m</span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
