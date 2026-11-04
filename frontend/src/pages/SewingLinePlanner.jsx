import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ListTree,
  Wand2,
  Wrench,
  Zap,
  Save,
  FolderDown,
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
  const [punchDate, setPunchDate] = useState(() => new Date().toISOString().slice(0, 10));

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

  // persist: save master + date-wise child, and load a saved layout back
  const saveMutation = useMutation({
    mutationFn: () =>
      api
        .post("/line-planner/erp/save-layout/", { result, date: punchDate })
        .then((r) => r.data),
    onSuccess: (d) => toast.success(`Layout saved · ${d.layout_date}`),
    onError: (err) => toast.error(err?.response?.data?.detail || "Save failed"),
  });

  const loadMutation = useMutation({
    mutationFn: () =>
      api
        .get("/line-planner/erp/saved-layout/", {
          params: {
            obm_id: Number(styleId),
            line_no: style?.line_id ?? 0,
            floor: style?.floor_id ?? 0,
            date: punchDate,
          },
        })
        .then((r) => r.data),
    onSuccess: (d) => {
      if (!d.saved || !d.result) {
        toast("No saved layout for this style yet");
        return;
      }
      setResult(d.result);
      const inp = d.result.inputs || {};
      setForm((f) => ({
        ...f,
        manpower: inp.manpower ?? f.manpower,
        efficiency: inp.efficiency != null ? Math.round(inp.efficiency * 100) : f.efficiency,
        working_hours: inp.working_hours ?? f.working_hours,
        shape: inp.shape || f.shape,
      }));
      toast.success(`Loaded ${d.source}${d.layout_date ? ` · ${d.layout_date}` : ""}`);
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Load failed"),
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

  // date-wise machine punch record → operator per assigned machine (name + photo)
  const operatorsQ = useQuery({
    queryKey: ["lp-erp-operators", punchDate, usedMachines.join(",")],
    queryFn: () =>
      api
        .post("/line-planner/erp/operators/", { date: punchDate, machine_nos: usedMachines })
        .then((r) => r.data),
    enabled: !!token && usedMachines.length > 0,
  });
  const operatorByMachine = operatorsQ.data?.operators || {};

  // serpentine layout: left = odd slots, right = even, input (slot 1/2) at bottom
  const [leftSlots, rightSlots] = useMemo(() => {
    const left = [];
    const right = [];
    operators.forEach((o, i) => (i % 2 === 0 ? left : right).push(o));
    return [left.slice().reverse(), right.slice().reverse()];
  }, [operators]);

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

  function pickMachine(slotNo, machine_no, machine_id) {
    setResult((r) => ({
      ...r,
      operators: (r.operators ?? []).map((s) =>
        s.slot_no === slotNo
          ? { ...s, machine_no, machine_id, machine_missing: !machine_no }
          : s
      ),
    }));
    setEditSlot(null);
  }

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
            <button type="button" disabled={!styleId || loadMutation.isPending} onClick={() => loadMutation.mutate()} className={btnSecondary}>
              <FolderDown className="h-4 w-4" /> Load saved
            </button>
            <button type="button" disabled={!operators.length || saveMutation.isPending} onClick={() => saveMutation.mutate()} className={btnPrimary}>
              <Save className="h-4 w-4" /> Save layout
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

          {/* Line Layout table (serpentine two-column floor view) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
            <div className="flex flex-col gap-2 bg-gradient-to-r from-cyan-500 to-teal-500 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-center text-base font-bold tracking-wide text-white sm:text-left">
                Line Layout
              </span>
              <div className="flex items-center justify-center gap-3 text-xs text-cyan-50">
                <span>{result.style?.stl_no} · {result.style?.hr_line_name} · {operators.length} operators</span>
                <label className="flex items-center gap-1">
                  <span className="uppercase tracking-wide">Punch date</span>
                  <input
                    type="date"
                    value={punchDate}
                    onChange={(e) => setPunchDate(e.target.value)}
                    className="rounded bg-white/90 px-2 py-1 text-slate-800"
                  />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-y-0 lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
              <LayoutColumn
                slots={leftSlots}
                color={colorFor}
                typeOrder={typeOrder}
                operatorByMachine={operatorByMachine}
                operatorsLoading={operatorsQ.isFetching}
                editSlot={editSlot}
                setEditSlot={setEditSlot}
                lineNo={result.line?.line_no}
                floor={result.line?.floor}
                usedMachines={usedMachines}
                onPick={pickMachine}
              />
              <LayoutColumn
                slots={rightSlots}
                color={colorFor}
                typeOrder={typeOrder}
                operatorByMachine={operatorByMachine}
                operatorsLoading={operatorsQ.isFetching}
                editSlot={editSlot}
                setEditSlot={setEditSlot}
                lineNo={result.line?.line_no}
                floor={result.line?.floor}
                usedMachines={usedMachines}
                onPick={pickMachine}
              />
            </div>
          </div>

          {/* machine summary */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Machine summary</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-400">
                  <tr><th className="py-1 pr-6">Type</th><th className="px-4 text-right">Req</th><th className="px-4 text-right">Avail</th><th className="px-4 text-right">Short</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s) => (
                    <tr key={s.type}>
                      <td className="py-1 pr-6 font-medium text-slate-700">
                        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colorFor(s.type, typeOrder) }} />
                        {s.type}
                      </td>
                      <td className="px-4 text-right tabular-nums">{s.required}</td>
                      <td className="px-4 text-right tabular-nums">{s.available}</td>
                      <td className={`px-4 text-right tabular-nums font-semibold ${s.shortage ? "text-rose-600" : "text-emerald-600"}`}>{s.shortage || "—"}</td>
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

// one serpentine column of the Line Layout table (dense, GSD-style grid)
const ROW_GRID = "grid grid-cols-[92px_minmax(0,1fr)_30px_112px] items-center gap-x-2";

function LayoutColumn({
  slots, color, typeOrder, operatorByMachine, operatorsLoading,
  editSlot, setEditSlot, lineNo, floor, usedMachines, onPick,
}) {
  return (
    <div className="min-w-0 lg:px-3">
      <div className={`${ROW_GRID} sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-1 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500`}>
        <span className="text-center">Machine</span>
        <span>Operation</span>
        <span className="text-right">SMV</span>
        <span className="pl-1">Employee</span>
      </div>
      <div>
        {slots.map((op, idx) => (
          <StationRow
            key={op.slot_no}
            op={op}
            zebra={idx % 2 === 1}
            color={color(op.machine_type, typeOrder)}
            operator={op.machine_no ? operatorByMachine[op.machine_no] : null}
            operatorsLoading={operatorsLoading}
            editing={editSlot === op.slot_no}
            onEdit={() => setEditSlot(editSlot === op.slot_no ? null : op.slot_no)}
            lineNo={lineNo}
            floor={floor}
            exclude={usedMachines.filter((m) => m !== op.machine_no)}
            onPick={(no, id) => onPick(op.slot_no, no, id)}
          />
        ))}
        {slots.length === 0 ? <div className="py-8 text-center text-xs text-slate-400">—</div> : null}
      </div>
    </div>
  );
}

function StationRow({ op, color, operator, operatorsLoading, editing, onEdit, lineNo, floor, exclude, onPick, zebra }) {
  const shared = op.operator_count > 1;
  const rowBg = op.is_bottleneck ? "bg-rose-50" : zebra ? "bg-slate-50/60" : "bg-white";
  return (
    <div className={`${ROW_GRID} border-b border-slate-100 px-1 py-1.5 ${rowBg}`}>
      {/* Machine */}
      <div className="flex items-center gap-1.5">
        <MachineIcon badge={op.slot_no} />
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="rounded px-1 py-px text-[9px] font-bold uppercase leading-tight text-white" style={{ background: color }}>
            {op.machine_type}
          </span>
          <MachinePicker
            op={op} editing={editing} onEdit={onEdit}
            lineNo={lineNo} floor={floor} exclude={exclude} onPick={onPick}
          />
        </div>
      </div>

      {/* Operation(s) */}
      <div className="min-w-0">
        {op.operations.map((o, i) => (
          <div key={`${o.id}-${i}`} className="truncate text-[13px] leading-5 text-slate-700" title={`${o.operation_name} · ${o.smv}`}>
            {o.operation_name}
          </div>
        ))}
        {shared ? <div className="text-[9px] leading-3 text-slate-400">Stn {op.station_no} · opr {op.sub_index}/{op.operator_count}</div> : null}
      </div>

      {/* SMV(s) */}
      <div className="text-right">
        {op.operations.map((o, i) => (
          <div key={`${o.id}-${i}`} className="text-[13px] leading-5 tabular-nums text-slate-600">{o.smv}</div>
        ))}
      </div>

      {/* Employee (date-wise machine punch) */}
      <div>
        <OperatorCell operator={operator} loading={operatorsLoading} hasMachine={!!op.machine_no} />
      </div>
    </div>
  );
}

function MachineIcon({ badge }) {
  return (
    <div className="relative flex-shrink-0">
      <svg width="34" height="28" viewBox="0 0 46 38" fill="none" aria-hidden="true">
        <rect x="3" y="29" width="40" height="6" rx="2" fill="#cbd5e1" />
        <rect x="8" y="13" width="7" height="18" rx="2" fill="#e2e8f0" />
        <rect x="8" y="12" width="31" height="7" rx="3" fill="#e2e8f0" />
        <rect x="32" y="12" width="7" height="14" rx="2" fill="#cbd5e1" />
        <rect x="35" y="26" width="1.6" height="4" fill="#94a3b8" />
        <rect x="17" y="7" width="3" height="6" rx="1" fill="#f59e0b" />
        <circle cx="12" cy="22" r="2" fill="#94a3b8" />
      </svg>
      <span className="absolute -left-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded bg-teal-500 px-0.5 text-[9px] font-bold leading-none text-white shadow">
        {badge}
      </span>
    </div>
  );
}

function MachinePicker({ op, editing, onEdit, lineNo, floor, exclude, onPick }) {
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
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={onEdit}
        className={`w-full truncate rounded px-1 text-center text-[9px] leading-tight ${op.machine_missing ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}
        title={op.machine_missing ? "No machine assigned" : op.machine_no || "Pick machine"}
      >
        {op.machine_missing ? "no mc" : op.machine_no || "— pick —"}
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

function OperatorCell({ operator, loading, hasMachine }) {
  if (!hasMachine) return <span className="text-[11px] text-slate-300">—</span>;
  if (!operator) return <span className="text-[10px] text-slate-400">{loading ? "…" : "no punch"}</span>;
  return (
    <div className="flex items-center gap-1.5">
      <OperatorAvatar name={operator.name} photo={operator.photo_url} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[11px] font-semibold text-slate-800" title={operator.name}>{operator.name}</div>
        <div className="flex items-center gap-1">
          {operator.designation ? <span className="truncate text-[9px] text-slate-500">{operator.designation}</span> : null}
          {operator.efficiency != null ? (
            <span className="rounded bg-emerald-500 px-1 text-[9px] font-bold text-white">{operator.efficiency}%</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OperatorAvatar({ name, photo }) {
  const [err, setErr] = useState(false);
  const initials = (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (photo && !err) {
    return (
      <img
        src={photo}
        onError={() => setErr(true)}
        alt={name}
        className="h-7 w-7 flex-shrink-0 rounded object-cover ring-1 ring-slate-200"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-600">
      {initials}
    </span>
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
