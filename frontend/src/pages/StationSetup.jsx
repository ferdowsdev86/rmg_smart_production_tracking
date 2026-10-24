import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import toast from "react-hot-toast";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

const NPT_CATEGORIES = [
  { id: 1, label: "Machine & Utility Related" },
  { id: 2, label: "Material Related" },
  { id: 3, label: "Production Related" },
  { id: 4, label: "Technical Related" },
];

/** NPT type master list (npt_library) — list + add / rename / delete. */
function NptTypeSetup() {
  const qc = useQueryClient();
  const [cat, setCat] = useState(1);
  const [newReason, setNewReason] = useState("");
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["npt-library"],
    queryFn: () => api.get("/automation/npt_library/").then((r) => r.data.groups || []),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["npt-library"] });
  const onErr = (e) => toast.error(e?.response?.data?.detail || e.message || "Failed");

  const createM = useMutation({
    mutationFn: () => api.post("/automation/npt_library/", { catogery_id: cat, npt_reason: newReason.trim() }),
    onSuccess: () => {
      toast.success("NPT reason added");
      setNewReason("");
      invalidate();
    },
    onError: onErr,
  });
  const updateM = useMutation({
    mutationFn: ({ id, npt_reason, catogery_id }) =>
      api.put("/automation/npt_library/", { id, npt_reason, catogery_id }),
    onSuccess: () => {
      toast.success("NPT reason updated");
      setEditId(null);
      invalidate();
    },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: (id) => api.delete("/automation/npt_library/", { params: { id } }),
    onSuccess: () => {
      toast.success("NPT reason deleted");
      invalidate();
    },
    onError: onErr,
  });

  const groups = NPT_CATEGORIES.map((c) => ({
    ...c,
    reasons: (data || []).find((g) => g.catogery_id === c.id)?.reasons || [],
  }));

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">NPT Type Setup</h2>
          <p className="text-sm text-slate-500">
            Reasons the devices and reports use, per category (table <code>npt_library</code>).
          </p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newReason.trim()) return toast.error("Write the NPT reason first.");
            createM.mutate();
          }}
        >
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
            value={cat}
            onChange={(e) => setCat(Number(e.target.value))}
          >
            {NPT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <input
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            placeholder="New NPT reason…"
            className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={createM.isPending}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            + Add
          </button>
        </form>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading NPT types…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {groups.map((g) => (
            <div key={g.id} className="rounded-xl border border-slate-200">
              <div className="flex items-center justify-between rounded-t-xl bg-slate-800 px-3 py-2 text-[12px] font-bold text-white">
                {g.label}
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">{g.reasons.length}</span>
              </div>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {g.reasons.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                    {editId === r.id ? (
                      <>
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-[13px]"
                          autoFocus
                        />
                        <button
                          type="button"
                          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white"
                          disabled={updateM.isPending}
                          onClick={() => {
                            if (!editText.trim()) return toast.error("Reason can not be empty.");
                            updateM.mutate({ id: r.id, npt_reason: editText.trim() });
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500"
                          onClick={() => setEditId(null)}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-slate-700" title={r.npt_reason}>
                          {r.npt_reason}
                        </span>
                        <button
                          type="button"
                          title="Rename"
                          className="rounded px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          onClick={() => {
                            setEditId(r.id);
                            setEditText(r.npt_reason);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          className="rounded px-1.5 py-0.5 text-[12px] text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                          disabled={deleteM.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete "${r.npt_reason}"?`)) deleteM.mutate(r.id);
                          }}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </li>
                ))}
                {!g.reasons.length ? (
                  <li className="px-3 py-3 text-center text-[12px] text-slate-400">No reasons yet</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SortRow({ row, operations, onChange }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.uid,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-12 gap-2 items-center rounded-lg border border-slate-100 bg-white px-2 py-2"
    >
      <div className="col-span-1 text-xs text-slate-500">#{row.station_number}</div>
      <div className="col-span-1 flex justify-center text-slate-400" {...listeners} {...attributes} title="Drag">
        ⠿
      </div>
      <div className="col-span-4">
        <select
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
          value={row.operation_type}
          onChange={(e) => onChange(row.uid, { operation_type: e.target.value })}
        >
          {operations.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-3">
        <input
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
          value={row.machine_type}
          onChange={(e) => onChange(row.uid, { machine_type: e.target.value })}
        />
      </div>
      <div className="col-span-1">
        <input
          type="number"
          step="0.01"
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
          value={row.standard_time}
          onChange={(e) => onChange(row.uid, { standard_time: parseFloat(e.target.value) })}
        />
      </div>
      <div className="col-span-2">
        <input
          type="number"
          min={1}
          max={5}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
          value={row.required_skill_level}
          onChange={(e) => onChange(row.uid, { required_skill_level: parseInt(e.target.value, 10) })}
        />
      </div>
    </div>
  );
}

export default function StationSetup() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const { data: lines } = useQuery({
    queryKey: ["lines"],
    queryFn: () => api.get("/floors/lines/").then((r) => r.data),
    enabled: !!token,
  });

  const { data: operations } = useQuery({
    queryKey: ["operations"],
    queryFn: () => api.get("/floors/operations/").then((r) => r.data),
    enabled: !!token,
  });

  const [lineId, setLineId] = useState(null);
  useEffect(() => {
    if (!lineId && lines?.length) setLineId(String(lines[0].id));
  }, [lines, lineId]);

  const { data: stations, isLoading } = useQuery({
    queryKey: ["stations-setup", lineId],
    queryFn: () => api.get("/floors/stations/", { params: { line: lineId } }).then((r) => r.data),
    enabled: !!token && !!lineId,
  });

  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!stations) return;
    setRows(
      stations.map((s) => ({
        uid: `s-${s.id}`,
        id: s.id,
        station_number: s.station_number,
        operation_type: s.operation_type,
        position_x: s.position_x,
        position_y: s.position_y,
        machine_type: s.machine_type,
        standard_time: s.standard_time,
        symbol_icon: s.symbol_icon,
        required_skill_level: s.required_skill_level ?? 1,
      })),
    );
  }, [stations]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ids = useMemo(() => rows.map((r) => r.uid), [rows]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = rows.map((r, idx) => ({
        station_number: idx + 1,
        operation_type: r.operation_type,
        position_x: (idx % 10) * 1.0,
        position_y: Math.floor(idx / 10) * 1.0,
        machine_type: r.machine_type,
        standard_time: r.standard_time,
        symbol_icon: r.symbol_icon || r.operation_type,
        required_skill_level: r.required_skill_level,
      }));
      await api.post(`/floors/lines/${lineId}/stations/bulk/`, payload);
    },
    onSuccess: () => {
      toast.success("Station layout saved");
      qc.invalidateQueries({ queryKey: ["stations-setup", lineId] });
      qc.invalidateQueries({ queryKey: ["line-stations"] });
    },
    onError: () => toast.error("Save failed"),
  });

  const templateMutation = useMutation({
    mutationFn: async (name) => {
      const stationsPayload = rows.map((r, idx) => ({
        station_number: idx + 1,
        operation_type: r.operation_type,
        position_x: (idx % 10) * 1.0,
        position_y: Math.floor(idx / 10) * 1.0,
        machine_type: r.machine_type,
        standard_time: r.standard_time,
        symbol_icon: r.symbol_icon || r.operation_type,
        required_skill_level: r.required_skill_level,
      }));
      await api.post("/floors/layout-templates/", { name, floor: null, stations: stationsPayload });
    },
    onSuccess: () => {
      toast.success("Template saved");
      qc.invalidateQueries({ queryKey: ["layout-templates"] });
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["layout-templates"],
    queryFn: () => api.get("/floors/layout-templates/").then((r) => r.data),
    enabled: !!token,
  });

  const [templateId, setTemplateId] = useState(null);
  const applyMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/floors/lines/${lineId}/apply-template/`, { template_id: templateId });
    },
    onSuccess: () => {
      toast.success("Template applied");
      qc.invalidateQueries({ queryKey: ["stations-setup", lineId] });
    },
  });

  function onDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.uid === active.id);
    const newIndex = rows.findIndex((r) => r.uid === over.id);
    setRows(arrayMove(rows, oldIndex, newIndex));
  }

  function onChange(uid, patch) {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Station Setup</h1>
          <p className="text-sm text-slate-600 mt-1">
            Drag rows to reorder stations, edit operation / machine / SAM / skill, then save.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={lineId ?? ""}
            onChange={(e) => setLineId(e.target.value)}
          >
            {(lines ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            Save layout
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            onClick={() => {
              const name = window.prompt("Template name?");
              if (name) templateMutation.mutate(name);
            }}
          >
            Save as template
          </button>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
              value={templateId ?? ""}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Choose template…</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              disabled={!templateId || applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
            >
              Apply
            </button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="text-sm text-slate-600">Loading stations…</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
              {rows.map((row) => (
                <SortRow
                  key={row.uid}
                  row={row}
                  operations={operations ?? []}
                  onChange={onChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <NptTypeSetup />
    </div>
  );
}
