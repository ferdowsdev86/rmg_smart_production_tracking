import { RAG_COLORS } from "./config";

export function Card({ children, className = "", rag, id, onClick }) {
  const border = rag ? RAG_COLORS[rag].border : "border-slate-200";
  return (
    <div
      id={id}
      onClick={onClick}
      className={`rounded-xl border-l-4 ${border} border-y border-r border-y-slate-200 border-r-slate-200 bg-white p-3 shadow-sm ${onClick ? "cursor-pointer transition hover:shadow-md" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Panel({ title, right, children, className = "", id }) {
  return (
    <section id={id} className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${className}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function RagDot({ rag, pulse = false }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${pulse ? "animate-pulse" : ""}`}
      style={{ background: RAG_COLORS[rag]?.dot || RAG_COLORS.grey.dot }}
    />
  );
}

export function RagPill({ rag, children }) {
  const c = RAG_COLORS[rag] || RAG_COLORS.grey;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${c.bg} ${c.text}`}>
      <RagDot rag={rag} />
      {children}
    </span>
  );
}

export const STATUS_PILL = {
  running: { label: "Running", cls: "bg-emerald-50 text-emerald-700" },
  slow: { label: "Slow", cls: "bg-amber-50 text-amber-700" },
  idle: { label: "Idle", cls: "bg-orange-50 text-orange-700" },
  down: { label: "Down", cls: "bg-rose-50 text-rose-700" },
  notstarted: { label: "Not started", cls: "bg-slate-100 text-slate-500" },
};

export function Spark({ values = [], width = 56, height = 18 }) {
  if (!values.length) return <span className="text-slate-300">·</span>;
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => `${i * step},${height - (v / max) * (height - 2) - 1}`).join(" ");
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={pts} fill="none" stroke="#2a66c4" strokeWidth="1.5" />
    </svg>
  );
}

export const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
