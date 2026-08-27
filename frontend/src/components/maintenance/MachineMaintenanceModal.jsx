import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { X, Wrench } from "lucide-react";

import api from "../../lib/api";

const SHIFT_OPTIONS = ["", "A", "B", "C", "General"];
const STATUS_OPTIONS = ["", "Running", "Idle", "Under Maintenance", "Breakdown", "Repaired"];

function emptyForm() {
  return {
    maintenance_date: "",
    machine_id: "",
    operator_id: "",
    mechanic_id: "",
    shift: "",
    machine_status: "",
  };
}

/** Parse stored remarks — supports legacy plain text or JSON with per-event remarks. */
function parseEventRemarks(raw) {
  if (!raw) return {};
  const text = String(raw).trim();
  if (!text) return {};
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const map = {};
      for (const item of data.events || []) {
        if (item?.event_id != null) map[String(item.event_id)] = item.remarks || "";
      }
      return map;
    } catch {
      return {};
    }
  }
  return {};
}

function serializeEventRemarks(eventRemarks) {
  const events = Object.entries(eventRemarks)
    .filter(([, remarks]) => String(remarks || "").trim())
    .map(([event_id, remarks]) => ({
      event_id: Number(event_id),
      remarks: String(remarks).trim(),
    }));
  if (!events.length) return "";
  return JSON.stringify({ events });
}

/**
 * Modal form for inserting a daily_machin_maintanance row.
 *
 * Pre-filled from a derived list row (date + machine). At the bottom, each
 * sewing_log event (flag4=1) is listed with its ID and a remarks field.
 */
export function MachineMaintenanceModal({ open, source, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [eventRemarks, setEventRemarks] = useState({});

  const { data: machines = [] } = useQuery({
    queryKey: ["maintenance-available-machines"],
    queryFn: () =>
      api
        .get("/floors/daily-machin-maintanance/available-machines/")
        .then((r) => r.data),
    enabled: open,
  });

  const saved = source?.saved || null;
  const events = source?.events ?? [];

  useEffect(() => {
    if (open) {
      const s = source?.saved;
      setForm({
        ...emptyForm(),
        maintenance_date: s?.maintenance_date || source?.date || "",
        machine_id:
          s?.machine_id != null
            ? String(s.machine_id)
            : source?.machin_id != null
              ? String(source.machin_id)
              : "",
        operator_id: s?.operator_id != null ? String(s.operator_id) : "",
        mechanic_id: s?.mechanic_id != null ? String(s.mechanic_id) : "",
        shift: s?.shift || "",
        machine_status: s?.machine_status || "",
      });

      const parsed = parseEventRemarks(s?.remarks);
      const initial = {};
      for (const ev of source?.events ?? []) {
        initial[String(ev.id)] = parsed[String(ev.id)] || "";
      }
      setEventRemarks(initial);
    }
  }, [open, source]);

  const createMutation = useMutation({
    mutationFn: (payload) =>
      saved?.id
        ? api.put(`/floors/daily-machin-maintanance/${saved.id}/`, payload)
        : api.post("/floors/daily-machin-maintanance/", payload),
    onSuccess: () => {
      toast.success(saved?.id ? "Maintenance entry updated" : "Maintenance entry saved");
      qc.invalidateQueries({ queryKey: ["daily-machin-maintanance"] });
      onClose();
    },
    onError: (err) => {
      const data = err?.response?.data;
      const msg =
        (data && (data.detail || Object.values(data).flat().join(" "))) || "Save failed";
      toast.error(msg);
    },
  });

  if (!open) return null;

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const updateEventRemark = (eventId) => (e) => {
    setEventRemarks((prev) => ({ ...prev, [String(eventId)]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.maintenance_date) return toast.error("Date is required");
    if (form.machine_id === "") return toast.error("Machine is required");

    const toIntOrNull = (v) => (v === "" ? null : Number(v));
    createMutation.mutate({
      maintenance_date: form.maintenance_date,
      machine_id: Number(form.machine_id),
      operator_id: toIntOrNull(form.operator_id),
      mechanic_id: toIntOrNull(form.mechanic_id),
      shift: form.shift,
      machine_status: form.machine_status,
      remarks: serializeEventRemarks(eventRemarks),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="machine-maintenance-modal-title"
      onClick={onClose}
    >
      <form
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
            <h2
              id="machine-maintenance-modal-title"
              className="text-lg font-semibold text-slate-900"
            >
              Daily Machine Maintenance
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <Field label="Date" required>
            <input
              type="date"
              value={form.maintenance_date}
              onChange={update("maintenance_date")}
              className={inputCls}
              required
            />
          </Field>

          <Field label="Machine" required>
            <select
              value={form.machine_id}
              onChange={update("machine_id")}
              className={inputCls}
              required
            >
              <option value="">Select machine…</option>
              {machines.map((m) => (
                <option key={m.machin_id} value={m.machin_id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Operator ID">
            <input
              type="number"
              value={form.operator_id}
              onChange={update("operator_id")}
              className={inputCls}
              placeholder="Optional"
            />
          </Field>

          <Field label="Mechanic ID">
            <input
              type="number"
              value={form.mechanic_id}
              onChange={update("mechanic_id")}
              className={inputCls}
              placeholder="Optional"
            />
          </Field>

          <Field label="Shift">
            <select value={form.shift} onChange={update("shift")} className={inputCls}>
              {SHIFT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "—" : s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Machine Status">
            <select
              value={form.machine_status}
              onChange={update("machine_status")}
              className={inputCls}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "—" : s}
                </option>
              ))}
            </select>
          </Field>

          {events.length > 0 && (
            <div className="sm:col-span-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Events from sewing_log (flag4 = 1)
              </div>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {events.map((ev, idx) => (
                  <div
                    key={ev.id}
                    className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[7rem_1fr]"
                  >
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Event {idx + 1}
                      </div>
                      <div className="font-mono font-medium text-slate-800">ID {ev.id}</div>
                      {ev.logged_at ? (
                        <div className="text-xs text-slate-500">{ev.logged_at}</div>
                      ) : null}
                    </div>
                    <input
                      type="text"
                      value={eventRemarks[String(ev.id)] || ""}
                      onChange={updateEventRemark(ev.id)}
                      className={inputCls}
                      placeholder="Remarks for this event…"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {createMutation.isPending ? "Saving…" : "Save entry"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300";

function Field({ label, required, className = "", children }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

/** Human-readable summary for the list table. */
export function formatMaintenanceRemarks(raw) {
  if (!raw) return "";
  const text = String(raw).trim();
  if (!text) return "";
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const parts = (data.events || [])
        .filter((e) => e?.remarks)
        .map((e) => `#${e.event_id}: ${e.remarks}`);
      return parts.join(" · ");
    } catch {
      return text;
    }
  }
  return text;
}
