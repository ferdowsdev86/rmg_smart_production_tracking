import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ListTree,
  Wand2,
  Wrench,
  Zap,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

// one colour per machine type (badge)
const TYPE_COLORS = [
  "#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2",
  "#ca8a04", "#dc2626", "#4f46e5", "#15803d", "#b45309", "#9333ea",
];
function colorFor(type, order) {
  const i = order.indexOf(type);
  return TYPE_COLORS[(i < 0 ? 0 : i) % TYPE_COLORS.length];
}

const SHAPES = [
  { v: "straight", label: "Straight 2-row" },
  { v: "u", label: "U-shape" },
  { v: "zigzag", label: "Zig-zag" },
];

export default function SewingLinePlanner() {
  const token = useAuthStore((s) => s.accessToken);
  const [styleId, setStyleId] = useState("");
  const [form, setForm] = useState({
    manpower: "",
    target_per_hour: "",
    efficiency: "",
    working_hours: "",
    shape: "straight",
  });
  const [result, setResult] = useState(null);
  const [editSlot, setEditSlot] = useState(null); // slot_no being edited

  const stylesQ = useQuery({
    queryKey: ["lp-erp-styles"],
    queryFn: () => api.get("/line-planner/erp/styles/").then((r) => r.data),
    enabled: !!token,
  });
  const styles = stylesQ.data?.results ?? [];
  const style = styles.find((s) => String(s.obm_id) === String(styleId));

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const genMutation = useMutation({
    mutationFn: (assign) =>
      api
        .post("/line-planner/erp/generate/", {
          obm_id: Number(styleId),
          manpower: form.manpower ? Number(form.manpower) : undefined,
          target_per_hour: form.target_per_hour ? Number(form.target_per_hour) : undefined,
          efficiency: form.efficiency ? Number(form.efficiency) / 100 : undefined,
          working_hours: form.working_hours ? Number(form.working_hours) : undefined,
          shape: form.shape,
          assign,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setResult(data);
      toast.success("Layout generated");
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Generate failed"),
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      api
        .post("/line-planner/erp/assign/", {
          line_no: result?.line?.line_no,
          floor: result?.line?.floor,
          operators: result?.operators,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setResult((r) => ({ ...r, operators: data.operators, transfers: data.transfers }));
      toast.success("Machines assigned");
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Assign failed"),
  });

  // one card per operator (= manpower). Fall back to stations for older responses.
  const operators = result?.operators ?? result?.stations ?? [];
  const typeOrder = useMemo(
    () => [...new Set(operators.map((s) => s.machine_type))],
    [operators]
  );
  // machine numbers already taken, so each operator picks an unused one
  const usedMachines = useMemo(
    () => operators.map((o) => o.machine_no).filter(Boolean),
    [operators]
  );
  const assignedCount = usedMachines.length;

  // machine summary: required vs available vs shortage per type
  const machinesQ = useQuery({
    queryKey: ["lp-erp-machines", result?.line?.line_no, result?.line?.floor],
    queryFn: () =>
      api
        .get("/line-planner/erp/machines/", {
          params: { line_no: result.line.line_no, floor: result.line.floor },
        })
        .then((r) => r.data),
    enabled: !!token && !!result?.line?.line_no,
  });
  const summary = useMemo(() => {
    const req = result?.machine_requirement || {};
    const avail = {};
    for (const m of machinesQ.data?.results || []) {
      const t = (m.machine_type || "").toUpperCase();
      avail[t] = (avail[t] || 0) + 1;
    }
    return Object.keys(req)
      .sort()
      .map((t) => {
        const a = avail[t.toUpperCase()] || 0;
        return { type: t, required: req[t], available: a, shortage: Math.max(0, req[t] - a) };
      });
  }, [result, machinesQ.data]);

  const canGenerate = !!styleId && (form.manpower || form.target_per_hour || style);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <ListTree className="h-6 w-6 text-primary" /> Sewing Line Layout Planner
        </h1>
        <p className="text-sm text-slate-600">
          Pick a style (live OB from <code>mbm_ie</code>) and generate a balanced line layout;
          assign real machines from <code>line_layout</code>.
        </p>
      </header>

      {/* inputs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <label className="md:col-span-2 flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Style (OB)</span>
            <select
              value={styleId}
              onChange={(e) => {
                setStyleId(e.target.value);
                setResult(null);
                const s = styles.find((x) => String(x.obm_id) === e.target.value);
                if (s)
                  setForm((f) => ({
                    ...f,
                    manpower: s.total_manpower || "",
                    efficiency: s.efficiency ? Math.round(s.efficiency) : "",
                    working_hours: s.planed_working_hour || "",
                  }));
              }}
              className={inputCls}
            >
              <option value="">{stylesQ.isLoading ? "Loading…" : "Select style…"}</option>
              {styles.map((s) => (
                <option key={s.obm_id} value={s.obm_id}>
                  {s.stl_no} · {s.buyer_name} · {s.hr_line_name} ({s.hr_floor_name})
                </option>
              ))}
            </select>
          </label>
          <Field label="Manpower"><input type="number" value={form.manpower} onChange={update("manpower")} className={inputCls} placeholder="e.g. 46" /></Field>
          <Field label="or Target/hr"><input type="number" value={form.target_per_hour} onChange={update("target_per_hour")} className={inputCls} placeholder="optional" /></Field>
          <Field label="Efficiency %"><input type="number" value={form.efficiency} onChange={update("efficiency")} className={inputCls} placeholder="60" /></Field>
          <Field label="Working hrs"><input type="number" value={form.working_hours} onChange={update("working_hours")} className={inputCls} placeholder="8" /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Line shape" className="w-44">
            <select value={form.shape} onChange={update("shape")} className={inputCls}>
              {SHAPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </Field>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={!canGenerate || genMutation.isPending} onClick={() => genMutation.mutate(false)} className={btnSecondary}>
              <Wand2 className="h-4 w-4" /> Generate layout
            </button>
            <button type="button" disabled={!operators.length || assignMutation.isPending} onClick={() => assignMutation.mutate()} className={btnSecondary}>
              <Wrench className="h-4 w-4" /> Assign machines
            </button>
            <button type="button" disabled={!canGenerate || genMutation.isPending} onClick={() => genMutation.mutate(true)} className={btnPrimary}>
              <Zap className="h-4 w-4" /> Generate &amp; assign
            </button>
          </div>
        </div>
      </div>

      {result ? (
        <>
          {/* metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Total SMV" value={result.total_smv} />
            <Metric label="Target / hr" value={result.target_per_hour} />
            <Metric label="Day target" value={result.day_target} />
            <Metric
              label="Operators"
              value={`${assignedCount}/${result.manpower_used}`}
              tone={assignedCount >= result.manpower_used ? "text-emerald-700" : "text-slate-800"}
            />
            <Metric label="Line balance %" value={`${result.balance_pct}%`} tone={result.balance_pct >= 75 ? "text-emerald-700" : result.balance_pct >= 50 ? "text-amber-700" : "text-rose-700"} />
            <Metric label="Bottleneck" value={`Stn ${result.bottleneck_station}`} tone="text-rose-700" />
          </div>

          {result.transfers?.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <b>Transfer suggestions:</b>{" "}
              {result.transfers.map((t) => `Borrow ${t.machine_no} from Line ${t.from_line} (Opr ${t.slot_no ?? t.station_no})`).join(" · ")}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            {/* floor view */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>▸ Input</span>
                <span>
                  Floor view · {operators.length} operators · {result.style?.stl_no} · {result.style?.hr_line_name}
                </span>
                <span>Output ▸</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {operators.map((op) => (
                  <OperatorCard
                    key={op.slot_no}
                    op={op}
                    color={colorFor(op.machine_type, typeOrder)}
                    onEdit={() => setEditSlot(op.slot_no)}
                    editing={editSlot === op.slot_no}
                    lineNo={result.line?.line_no}
                    floor={result.line?.floor}
                    exclude={usedMachines.filter((m) => m !== op.machine_no)}
                    onPick={(machine_no, machine_id) => {
                      setResult((r) => ({
                        ...r,
                        operators: (r.operators ?? []).map((s) =>
                          s.slot_no === op.slot_no
                            ? { ...s, machine_no, machine_id, machine_missing: !machine_no }
                            : s
                        ),
                      }));
                      setEditSlot(null);
                    }}
                  />
                ))}
              </div>
            </div>

            {/* machine summary side panel */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Machine summary</h3>
              <table className="min-w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-400">
                  <tr><th className="py-1">Type</th><th className="text-right">Req</th><th className="text-right">Avail</th><th className="text-right">Short</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s) => (
                    <tr key={s.type}>
                      <td className="py-1 font-medium text-slate-700">
                        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colorFor(s.type, typeOrder) }} />
                        {s.type}
                      </td>
                      <td className="text-right tabular-nums">{s.required}</td>
                      <td className="text-right tabular-nums">{s.available}</td>
                      <td className={`text-right tabular-nums font-semibold ${s.shortage ? "text-rose-600" : "text-emerald-600"}`}>{s.shortage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
          Select a style and click <b>Generate &amp; assign</b> to build a balanced layout.
        </div>
      )}
    </div>
  );
}

function OperatorCard({ op, color, onEdit, editing, onPick, lineNo, floor, exclude = [] }) {
  const token = useAuthStore((s) => s.accessToken);
  const avail = useQuery({
    queryKey: ["lp-avail", lineNo, op.machine_type, exclude.join(",")],
    queryFn: () =>
      api
        .get("/line-planner/erp/available-machines/", {
          params: { line_no: lineNo, floor, type: op.machine_type, exclude: exclude.join(",") },
        })
        .then((r) => r.data),
    enabled: !!token && editing && !!lineNo,
  });
  const shared = op.operator_count > 1;
  return (
    <div
      className={`w-40 rounded-xl border p-2 text-xs shadow-sm ${
        op.is_bottleneck ? "border-rose-400 bg-rose-50" : op.machine_missing ? "border-rose-300 bg-white" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-800">Opr {op.slot_no}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: color }}>{op.machine_type}</span>
      </div>
      <div className="text-[10px] font-medium text-slate-400">
        Stn {op.station_no}{shared ? ` · ${op.sub_index}/${op.operator_count}` : ""}
      </div>
      <div className="mt-1 space-y-0.5">
        {op.operations.map((o, i) => (
          <div key={`${o.id}-${i}`} className="truncate text-slate-600" title={`${o.operation_name} · ${o.smv} SMV`}>{o.operation_name}</div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{op.smv_load} min</span>
        <span>1 op</span>
      </div>
      <button type="button" onClick={onEdit} className={`mt-1 w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${op.machine_missing ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
        {op.machine_missing ? <><AlertTriangle className="mr-1 inline h-3 w-3" />no machine</> : op.machine_no || "— pick —"}
      </button>
      {editing ? (
        <select
          autoFocus
          className="mt-1 w-full rounded border border-slate-300 text-[11px]"
          value={op.machine_no || ""}
          onChange={(e) => {
            const m = (avail.data || []).find((x) => x.machine_no === e.target.value);
            onPick(e.target.value || null, m?.id ?? null);
          }}
        >
          <option value="">— none —</option>
          {(avail.data || []).map((m, i) => (
            <option key={`${m.id}-${i}`} value={m.machine_no}>
              {m.machine_no} ({m.machine_type}){m.same_line ? "" : ` · L${m.line_no}`}{m.type_match ? "" : " ⚠"}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const btnSecondary = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";

function Field({ label, className = "", children }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-[18px] font-bold tabular-nums ${tone || "text-slate-800"}`}>{value}</div>
    </div>
  );
}
