import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { Panel, RagDot } from "./ui";

/** Severity-sorted action list: problem + owner + since, with acknowledge. */
export default function ActionAlerts({ alerts }) {
  const [acked, setAcked] = useState({});
  const visible = alerts.filter((a) => !acked[a.id]);
  return (
    <Panel
      title="Action Alerts"
      right={<span className="text-[11px] font-semibold text-slate-400">{visible.length} open · {alerts.length - visible.length} acknowledged</span>}
    >
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-700">
          <Check className="h-4 w-4" /> No open issues — line is healthy.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visible.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 py-1.5">
              <RagDot rag={a.sev === "red" ? "red" : "amber"} pulse={a.sev === "red"} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-800" title={a.text}>
                {a.text}
                <span className="font-normal text-slate-500"> → {a.owner}</span>
                {a.since ? <span className="ml-1 text-[11px] font-normal text-slate-400">{a.since}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => setAcked((p) => ({ ...p, [a.id]: true }))}
                className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500 hover:bg-slate-200"
                title="Acknowledge"
              >
                Ack
              </button>
            </li>
          ))}
        </ul>
      )}
      {alerts.length === 0 ? null : (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
          <AlertTriangle className="h-3 w-3" /> rules: zero output, &lt;50% for 2 hrs, DHU limit, NPT running &gt; 15 min, behind expected pace
        </div>
      )}
    </Panel>
  );
}
