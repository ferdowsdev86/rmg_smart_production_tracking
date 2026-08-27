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
    </div>
  );
}
