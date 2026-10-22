import { Lightbulb } from "lucide-react";

import { Panel } from "./ui";

export default function InsightsPanel({ insights }) {
  return (
    <Panel title="Today's Insights">
      {insights.length ? (
        <ul className="space-y-1.5">
          {insights.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] font-medium leading-snug text-slate-700">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] text-slate-400">Not enough data yet.</div>
      )}
    </Panel>
  );
}
