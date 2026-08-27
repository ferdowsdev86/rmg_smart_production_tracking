import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

/** Map stored unit ("1", "Unit 1") to dropdown value. */
function normalizeUnitValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const fromLabel = value.match(/^unit\s*(\d+)$/i);
  if (fromLabel) return fromLabel[1];
  if (/^\d+$/.test(value)) return value;
  return value;
}

function unitDisplayLabel(raw, unitOptions = []) {
  const value = normalizeUnitValue(raw);
  if (!value) return "—";
  const match = unitOptions.find((option) => (option.value ?? option) === value);
  if (match?.label) return match.label;
  if (/^\d+$/.test(value)) return `Unit ${value}`;
  return value;
}

const EMPTY_FORM = {
  id: null,
  unit: "",
  style: "",
  product: "",
  product_type: "",
  layout_date: new Date().toISOString().slice(0, 10),
  floor: "",
  line: "",
  details: [],
};

function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function AssignPeopleModal({ open, layoutId, process, onClose, onSaved }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const debouncedSearch = useDebouncedValue(search);

  const {
    data: employees = [],
    isLoading: employeesLoading,
    isError: employeesError,
  } = useQuery({
    queryKey: ["hr-employees", debouncedSearch],
    queryFn: () =>
      api
        .get("/employees/hr-employees/", {
          params: { search: debouncedSearch || undefined, limit: 200 },
        })
        .then((r) => r.data.results ?? []),
    enabled: open,
    staleTime: 30_000,
  });

  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ["layout-process-assignments", layoutId, process?.finishing_process_id],
    queryFn: () =>
      api
        .get(`/floors/line-layouts/${layoutId}/process-assignments/`, {
          params: { process_id: process.finishing_process_id },
        })
        .then((r) => r.data),
    enabled: open && Boolean(layoutId && process?.finishing_process_id),
  });

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(new Set());
  }, [open, process?.finishing_process_id]);

  useEffect(() => {
    if (!existing?.employee_ids) return;
    setSelected(new Set(existing.employee_ids.map(String)));
  }, [existing]);

  const employeeNameById = useMemo(() => {
    const map = new Map();
    for (const row of existing?.assignments ?? []) {
      map.set(String(row.employee_id), row.employee_name || row.employee_id);
    }
    for (const emp of employees) {
      const id = String(emp.associate_id || emp.value || "");
      if (id) map.set(id, emp.as_name || emp.label || id);
    }
    return map;
  }, [existing, employees]);

  const assignedPeople = useMemo(() => {
    const ordered = [];
    const seen = new Set();
    for (const row of existing?.assignments ?? []) {
      const associateId = String(row.employee_id || "");
      if (!associateId || !selected.has(associateId) || seen.has(associateId)) continue;
      seen.add(associateId);
      ordered.push({
        associateId,
        name: employeeNameById.get(associateId) || associateId,
        workstationId: row.workstation_id,
        saved: true,
      });
    }
    for (const associateId of selected) {
      if (seen.has(associateId)) continue;
      seen.add(associateId);
      ordered.push({
        associateId,
        name: employeeNameById.get(associateId) || associateId,
        workstationId: null,
        saved: false,
      });
    }
    return ordered;
  }, [selected, existing, employeeNameById]);

  const addCandidates = useMemo(() => {
    return employees.filter((emp) => {
      const associateId = String(emp.associate_id || emp.value || "");
      return associateId && !selected.has(associateId);
    });
  }, [employees, selected]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post(`/floors/line-layouts/${layoutId}/process-assignments/`, {
        process_id: process.finishing_process_id,
        employee_ids: Array.from(selected),
      }),
    onSuccess: (res) => {
      const count = res.data.assigned_count ?? 0;
      toast.success(
        count
          ? `Saved ${count} assignment(s) for layout ${layoutId}, process ${process.finishing_process_id}`
          : "Cleared assignments for this process",
      );
      qc.invalidateQueries({ queryKey: ["layout-process-assignments", layoutId] });
      qc.invalidateQueries({ queryKey: ["line-layouts"] });
      onSaved(count);
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.detail || "Could not save assignments");
    },
  });

  if (!open || !process) return null;

  const maxSlots = Number(process.no_of_workstation) || 0;

  function removeAssigned(associateId) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(associateId);
      return next;
    });
  }

  function addEmployee(associateId) {
    setSelected((prev) => {
      if (prev.has(associateId)) return prev;
      if (maxSlots && prev.size >= maxSlots) {
        toast.error(`Maximum ${maxSlots} workstation(s) for this process`);
        return prev;
      }
      const next = new Set(prev);
      next.add(associateId);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">Assign people</h3>
          <p className="mt-1 text-sm text-slate-500">
            {process.process_name} · max {maxSlots || "—"} workstation(s)
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-slate-100 px-5 py-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Currently assigned ({assignedPeople.length})
              </h4>
              {maxSlots ? (
                <span className="text-xs text-slate-500">
                  {assignedPeople.length} / {maxSlots} slots
                </span>
              ) : null}
            </div>
            {existingLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading assignments…</p>
            ) : assignedPeople.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                No one assigned to this process yet. Search below to add people.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {assignedPeople.map((person) => (
                  <li
                    key={person.associateId}
                    className="flex items-start justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {person.name}
                      </span>
                      <span className="block text-xs font-mono text-slate-500">{person.associateId}</span>
                      {person.workstationId ? (
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          Workstation {String(person.workstationId).padStart(2, "0")}
                        </span>
                      ) : person.saved ? null : (
                        <span className="mt-0.5 block text-[11px] text-amber-600">New — save to apply</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAssigned(person.associateId)}
                      className="shrink-0 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="px-5 py-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Add people</h4>
            <input
              type="text"
              placeholder="Search employee name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <div className="mt-3">
              {employeesLoading ? (
                <p className="py-6 text-center text-sm text-slate-500">Loading employees…</p>
              ) : employeesError ? (
                <p className="py-6 text-center text-sm text-red-600">Could not load employees</p>
              ) : addCandidates.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  {debouncedSearch.trim()
                    ? selected.size >= maxSlots && maxSlots
                      ? `Maximum ${maxSlots} workstation(s) reached`
                      : "No more employees match this search"
                    : "Type a name or associate ID to search"}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {addCandidates.map((emp) => {
                    const associateId = String(emp.associate_id || emp.value || "");
                    const name = emp.as_name || emp.label || "—";
                    const atLimit = maxSlots > 0 && selected.size >= maxSlots;
                    return (
                      <li key={associateId}>
                        <button
                          type="button"
                          disabled={atLimit}
                          onClick={() => addEmployee(associateId)}
                          className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-slate-900">{name}</span>
                            <span className="block text-xs font-mono text-slate-500">{associateId}</span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-blue-600">Add</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <span className="text-sm text-slate-600">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutFormModal({ open, initial, options, onClose, onSaved }) {
  const [unit, setUnit] = useState(() => normalizeUnitValue(initial.unit));
  const [style, setStyle] = useState(initial.style ?? "");
  const [productKey, setProductKey] = useState(initial.product_type ?? "");
  const [layoutDate, setLayoutDate] = useState(initial.layout_date ?? "");
  const [floor, setFloor] = useState(initial.floor ?? "");
  const [line, setLine] = useState(initial.line ?? "");
  const [processes, setProcesses] = useState([]);
  const [assignProcess, setAssignProcess] = useState(null);

  const isEdit = Boolean(initial.id);
  const layoutId = initial.id;
  const selectedProduct = (options?.products ?? []).find((p) => p.product_type === productKey);

  const { data: linesForFloor } = useQuery({
    queryKey: ["lines-for-floor", floor],
    queryFn: () =>
      api.get("/floors/lines/", { params: { floor } }).then((r) => (Array.isArray(r.data) ? r.data : [])),
    enabled: Boolean(floor),
  });

  const { data: processesByProduct, isLoading: processesLoading } = useQuery({
    queryKey: ["finishing-processes-by-product", productKey],
    queryFn: () =>
      api
        .get("/floors/finishing-processes/by-product/", { params: { product_type: productKey } })
        .then((r) => r.data),
    enabled: Boolean(productKey) && open,
  });

  const unitOptions = useMemo(() => {
    const base = options?.units ?? [];
    const normalized = normalizeUnitValue(unit);
    if (normalized && !base.some((option) => (option.value ?? option) === normalized)) {
      return [{ value: normalized, label: unitDisplayLabel(normalized, base) }, ...base];
    }
    return base;
  }, [options?.units, unit]);

  useEffect(() => {
    if (!open) return;
    setUnit(normalizeUnitValue(initial.unit));
    setStyle(initial.style ?? "");
    setProductKey(initial.product_type ?? "");
    setLayoutDate(initial.layout_date ?? new Date().toISOString().slice(0, 10));
    setFloor(initial.floor ?? "");
    setLine(initial.line ?? "");
    setProcesses(initial.details?.length ? initial.details : []);
  }, [open, initial]);

  useEffect(() => {
    if (!productKey) return;
    if (isEdit && initial.details?.length) {
      setProcesses(
        initial.details.map((d) => ({
          finishing_process_id: d.finishing_process_id,
          process_name: d.process_name,
          sam: d.sam ?? "",
          machin_type: d.machin_type ?? "",
          display_order: d.display_order,
          no_of_workstation: d.no_of_workstation ?? 1,
          assigned_people_count: d.assigned_people_count ?? 0,
        })),
      );
      return;
    }
    if (!processesByProduct?.length) return;
    setProcesses(
      processesByProduct.map((p) => ({
        finishing_process_id: p.id,
        process_name: p.process_name,
        sam: p.sam ?? "",
        machin_type: p.machin_type ?? "",
        display_order: p.display_order,
        no_of_workstation: p.station_count ?? 1,
        assigned_people_count: 0,
      })),
    );
  }, [productKey, processesByProduct, isEdit, initial.details]);

  useEffect(() => {
    if (!floor) setLine("");
  }, [floor]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        unit: unit.trim(),
        style: style.trim(),
        product: selectedProduct?.label ?? productKey,
        product_type: productKey,
        layout_date: layoutDate,
        floor: Number(floor),
        line: Number(line),
        details: processes.map((p) => ({
          finishing_process_id: p.finishing_process_id,
          process_name: p.process_name,
          sam: p.sam ?? "",
          machin_type: p.machin_type ?? "",
          display_order: p.display_order,
          no_of_workstation: Number(p.no_of_workstation) || 0,
        })),
      };
      if (isEdit) {
        return api.patch(`/floors/line-layouts/${initial.id}/`, payload).then((r) => r.data);
      }
      return api.post("/floors/line-layouts/", payload).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Line layout updated" : "Line layout created");
      onSaved();
      onClose();
    },
    onError: (err) => {
      const d = err.response?.data;
      toast.error(d?.details?.[0] || d?.detail || "Could not save line layout");
    },
  });

  if (!open) return null;

  const totalWorkstation = processes.reduce(
    (sum, p) => sum + (Number(p.no_of_workstation) || 0),
    0,
  );
  const totalAssigned = processes.reduce(
    (sum, p) => sum + (Number(p.assigned_people_count) || 0),
    0,
  );
  const unassignedSlots = Math.max(0, totalWorkstation - totalAssigned);
  const canSave = unit && style && productKey && layoutDate && floor && line && processes.length;

  function handleAssignmentSaved(processId, count) {
    setProcesses((prev) =>
      prev.map((p) =>
        p.finishing_process_id === processId ? { ...p, assigned_people_count: count } : p,
      ),
    );
  }

  function updateProcessWorkstations(processId, value) {
    const count = Math.max(0, Number(value) || 0);
    setProcesses((prev) =>
      prev.map((p) =>
        p.finishing_process_id === processId ? { ...p, no_of_workstation: count } : p,
      ),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEdit ? "Edit line layout" : "New line layout"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Select unit, style, and product — processes load from <code>finishing_process</code> (
            is_active=1).
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Unit</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="">Select unit</option>
                {unitOptions.map((option) => {
                  const value = option.value ?? option;
                  const label = option.label ?? option;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Style</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                <option value="">Select style</option>
                {(options?.styles ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Product</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={productKey}
                onChange={(e) => {
                  setProductKey(e.target.value);
                  setProcesses([]);
                }}
              >
                <option value="">Select product</option>
                {(options?.products ?? []).map((p) => (
                  <option key={p.product_type} value={p.product_type}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Date</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={layoutDate}
                onChange={(e) => setLayoutDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Floor</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
              >
                <option value="">Select floor</option>
                {(options?.floors ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Line</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                disabled={!floor}
              >
                <option value="">Select line</option>
                {(linesForFloor ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {productKey ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Process name</th>
                    <th className="px-3 py-2">SAM</th>
                    <th className="px-3 py-2">Machine type</th>
                    <th className="px-3 py-2">No. of workstation</th>
                    <th className="px-3 py-2">Assign people</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {processesLoading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        Loading processes…
                      </td>
                    </tr>
                  ) : !processes.length ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        No active processes for this product type.
                      </td>
                    </tr>
                  ) : (
                    processes.map((p) => (
                      <tr key={p.finishing_process_id}>
                        <td className="px-3 py-2 tabular-nums text-slate-500">{p.display_order}</td>
                        <td className="px-3 py-2 font-medium text-slate-900">{p.process_name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{p.sam || "—"}</td>
                        <td className="px-3 py-2">{p.machin_type || "—"}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            className="w-20 rounded border border-slate-200 px-2 py-1 text-sm tabular-nums"
                            value={p.no_of_workstation ?? 0}
                            onChange={(e) =>
                              updateProcessWorkstations(p.finishing_process_id, e.target.value)
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={!layoutId}
                            title={layoutId ? "Assign employees" : "Save layout first"}
                            onClick={() => setAssignProcess(p)}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Assign{p.assigned_people_count ? ` (${p.assigned_people_count})` : ""}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {processes.length > 0 ? (
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                        Total workstation
                      </td>
                      <td className="px-3 py-2 font-bold tabular-nums text-slate-900">{totalWorkstation}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold tabular-nums text-blue-800">
                            Assigned {totalAssigned}
                          </span>
                          <span className="rounded-full bg-slate-200 px-2.5 py-1 font-semibold tabular-nums text-slate-700">
                            Open {unassignedSlots}
                          </span>
                          <span className="text-slate-500 tabular-nums">
                            {totalAssigned} / {totalWorkstation} slots filled
                          </span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Choose unit, style, and product to load process details.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>

      <AssignPeopleModal
        open={Boolean(assignProcess)}
        layoutId={layoutId}
        process={assignProcess}
        onClose={() => setAssignProcess(null)}
        onSaved={(count) => {
          if (assignProcess?.finishing_process_id) {
            handleAssignmentSaved(assignProcess.finishing_process_id, count);
          }
        }}
      />
    </div>
  );
}

export default function LineLayout() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [formInitial, setFormInitial] = useState(EMPTY_FORM);
  const [filterProductType, setFilterProductType] = useState("");

  const { data: options } = useQuery({
    queryKey: ["line-layout-options"],
    queryFn: () => api.get("/floors/line-layout-options/").then((r) => r.data),
    enabled: !!token,
  });

  const { data: layouts, isLoading, isError } = useQuery({
    queryKey: ["line-layouts", filterProductType],
    queryFn: () =>
      api
        .get("/floors/line-layouts/", {
          params: filterProductType ? { product_type: filterProductType } : {},
        })
        .then((r) => (Array.isArray(r.data) ? r.data : r.data.results ?? [])),
    enabled: !!token,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/floors/line-layouts/${id}/`),
    onSuccess: () => {
      toast.success("Line layout deleted");
      qc.invalidateQueries({ queryKey: ["line-layouts"] });
    },
    onError: () => toast.error("Could not delete"),
  });

  const productTypes = useMemo(
    () => options?.product_types ?? [],
    [options],
  );

  function openCreate() {
    setFormInitial({ ...EMPTY_FORM, layout_date: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  }

  function openEdit(row) {
    setFormInitial({
      id: row.layout_id ?? row.id,
      unit: normalizeUnitValue(row.unit),
      style: row.style ?? "",
      product: row.product ?? "",
      product_type: row.product_type ?? "",
      layout_date: row.layout_date ?? "",
      floor: row.floor ?? "",
      line: row.line ?? "",
      details: (row.details ?? []).map((d) => ({
        finishing_process_id: d.finishing_process_id,
        process_name: d.process_name,
        sam: d.sam ?? "",
        machin_type: d.machin_type ?? "",
        display_order: d.display_order,
        no_of_workstation: d.no_of_workstation ?? 1,
        assigned_people_count: d.assigned_people_count ?? 0,
      })),
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Line layout</h1>
          <p className="mt-1 text-sm text-slate-600">
            CRUD on <code className="text-xs">linelayouttemplate_master</code> + process lines from{" "}
            <code className="text-xs">finishing_process</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New line layout
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Filter by product type:</span>
        <button
          type="button"
          onClick={() => setFilterProductType("")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !filterProductType ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          All
        </button>
        {productTypes.map((pt) => (
          <button
            key={pt}
            type="button"
            onClick={() => setFilterProductType(pt)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filterProductType === pt ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {pt}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-card">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Layout ID</th>
              <th className="px-4 py-3">Product type</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Floor</th>
              <th className="px-4 py-3">Line</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Style</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Total workstation</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-red-600">
                  Could not load layouts. Run{" "}
                  <code className="text-xs">python manage.py migrate floors</code>.
                </td>
              </tr>
            ) : !layouts?.length ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                  No line layouts yet.
                </td>
              </tr>
            ) : (
              layouts.map((row) => (
                <tr key={row.layout_id ?? row.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-mono text-xs">{row.layout_id ?? row.id}</td>
                  <td className="px-4 py-3">{row.product_type || "—"}</td>
                  <td className="px-4 py-3">{row.layout_date || "—"}</td>
                  <td className="px-4 py-3">{row.floor_name || "—"}</td>
                  <td className="px-4 py-3">{row.line_name || "—"}</td>
                  <td className="px-4 py-3">{unitDisplayLabel(row.unit, options?.units)}</td>
                  <td className="px-4 py-3">{row.style || "—"}</td>
                  <td className="px-4 py-3">{row.product || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {row.total_workstation ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete layout #${row.layout_id ?? row.id}?`)) {
                            deleteMutation.mutate(row.layout_id ?? row.id);
                          }
                        }}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <LayoutFormModal
        key={`${formInitial.id ?? "new"}-${modalOpen}`}
        open={modalOpen}
        initial={formInitial}
        options={options}
        onClose={() => setModalOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["line-layouts"] })}
      />
    </div>
  );
}
