import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

const EMPTY_ROW = {
  layouttemplete_id: "",
  machin_no: "",
  employee_id: "",
};

function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function MachinManpowerLayout() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [layoutId, setLayoutId] = useState("");
  const [rows, setRows] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const debouncedSearch = useDebouncedValue(employeeSearch);

  const { data: layouts = [], isLoading: layoutsLoading } = useQuery({
    queryKey: ["line-layouts"],
    queryFn: () => api.get("/floors/line-layouts/").then((r) => r.data),
    enabled: !!token,
  });

  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: ["machin-manpower-form", layoutId],
    queryFn: () =>
      api.get(`/floors/machin-manpower-layout/form-context/${layoutId}/`).then((r) => r.data),
    enabled: !!token && !!layoutId,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["hr-employees", debouncedSearch],
    queryFn: () =>
      api
        .get("/employees/hr-employees/", {
          params: { search: debouncedSearch || undefined, limit: 200 },
        })
        .then((r) => r.data.results ?? []),
    enabled: !!layoutId,
    staleTime: 30_000,
  });

  const layout = context?.layout;
  const details = context?.details ?? [];
  const machines = context?.machines ?? [];

  useEffect(() => {
    if (!context) return;
    const existing = (context.assignments ?? []).map((row) => ({
      layouttemplete_id: String(row.layouttemplete_id),
      machin_no: String(row.machin_no),
      employee_id: String(row.employee_id),
    }));
    setRows(existing.length ? existing : []);
  }, [context]);

  const saveMutation = useMutation({
    mutationFn: (payload) => api.post("/floors/machin-manpower-layout/bulk-save/", payload),
    onSuccess: (res) => {
      toast.success(`Saved ${res.data.count} assignment(s)`);
      qc.invalidateQueries({ queryKey: ["machin-manpower-form", layoutId] });
    },
    onError: (err) => {
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Could not save assignments");
    },
  });

  function updateRow(index, patch) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow(detailId) {
    setRows((prev) => [
      ...prev,
      {
        ...EMPTY_ROW,
        layouttemplete_id: String(detailId),
      },
    ]);
  }

  function saveAll() {
    const assignments = rows
      .filter((row) => row.layouttemplete_id && row.machin_no && row.employee_id)
      .map((row) => ({
        layouttemplete_id: Number(row.layouttemplete_id),
        machin_no: Number(row.machin_no),
        employee_id: String(row.employee_id).trim(),
      }));
    saveMutation.mutate({ layout_id: Number(layoutId), assignments });
  }

  const employeeOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const emp of employees) {
      const id = String(emp.associate_id || emp.value || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push({
        id,
        label: emp.as_name || emp.label || id,
      });
    }
    for (const row of context?.assignments ?? []) {
      const id = String(row.employee_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push({ id, label: row.employee_name || id });
    }
    return list;
  }, [employees, context?.assignments]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Machin assign as per layout</h1>
          <p className="text-sm text-slate-600 mt-1">
            Assign machine ID and operator from <code className="text-xs">line_layout</code> to layout
            processes · saved in <code className="text-xs">machin_manpower_layout</code>
          </p>
        </div>
        {layoutId ? (
          <button
            type="button"
            onClick={saveAll}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Saving…" : "Save assignments"}
          </button>
        ) : null}
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">Layout</label>
        <select
          className="mt-2 w-full max-w-xl rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={layoutId}
          onChange={(e) => setLayoutId(e.target.value)}
          disabled={layoutsLoading}
        >
          <option value="">Select layout (linelayouttemplate_master)</option>
          {layouts.map((item) => (
            <option key={item.layout_id ?? item.id} value={item.layout_id ?? item.id}>
              #{item.layout_id ?? item.id} · {item.product_type || item.product} · {item.layout_date} ·{" "}
              {item.floor_name} / {item.line_name}
            </option>
          ))}
        </select>
      </div>

      {layoutId && contextLoading ? (
        <p className="text-sm text-slate-500">Loading layout details…</p>
      ) : null}

      {layout && !contextLoading ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-medium">Layout #{layout.layout_id}</span>
            <span className="mx-2">·</span>
            {layout.unit} / {layout.style} / {layout.product_type}
            <span className="mx-2">·</span>
            Date: {layout.layout_date}
            <span className="mx-2">·</span>
            {layout.floor_name} · {layout.line_name}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
              Layout details (linelayouttemplate_detail)
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Order</th>
                    <th className="px-4 py-2">Process</th>
                    <th className="px-4 py-2">Machin type</th>
                    <th className="px-4 py-2">Workstations</th>
                    <th className="px-4 py-2">Assigned</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {details.map((detail) => {
                    const assigned = rows.filter(
                      (r) => String(r.layouttemplete_id) === String(detail.id)
                    ).length;
                    return (
                      <tr key={detail.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 tabular-nums">{detail.display_order}</td>
                        <td className="px-4 py-2">{detail.process_name}</td>
                        <td className="px-4 py-2">{detail.machin_type || "—"}</td>
                        <td className="px-4 py-2 tabular-nums">{detail.no_of_workstation ?? 1}</td>
                        <td className="px-4 py-2 tabular-nums">{assigned}</td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => addRow(detail.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            <Plus className="h-3 w-3" />
                            Add row
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-800">Machine & manpower assignments</div>
              <input
                type="search"
                placeholder="Search employee…"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm w-48"
              />
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">
                No assignments yet. Use &quot;Add row&quot; on a layout detail above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Process</th>
                      <th className="px-4 py-2">Machine ID</th>
                      <th className="px-4 py-2">Employee ID</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${index}-${row.layouttemplete_id}`} className="border-t border-slate-100">
                        <td className="px-4 py-2">
                          <select
                            className="w-full min-w-[160px] rounded-md border border-slate-200 px-2 py-1.5"
                            value={row.layouttemplete_id}
                            onChange={(e) =>
                              updateRow(index, { layouttemplete_id: e.target.value })
                            }
                          >
                            <option value="">Select process</option>
                            {details.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.process_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            className="w-full min-w-[140px] rounded-md border border-slate-200 px-2 py-1.5"
                            value={row.machin_no}
                            onChange={(e) => updateRow(index, { machin_no: e.target.value })}
                          >
                            <option value="">Machine</option>
                            {machines.map((m) => (
                              <option key={m.machin_no} value={m.machin_no}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            className="w-full min-w-[200px] rounded-md border border-slate-200 px-2 py-1.5"
                            value={row.employee_id}
                            onChange={(e) => updateRow(index, { employee_id: e.target.value })}
                          >
                            <option value="">Employee</option>
                            {employeeOptions.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {emp.label} ({emp.id})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => removeRow(index)}
                            className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                            title="Remove row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(context?.assignments ?? []).length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
              Saved in database: {context.assignments.length} row(s). Click &quot;Save assignments&quot;
              to replace all rows for this layout.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
