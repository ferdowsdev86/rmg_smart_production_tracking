import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Filter, ListChecks, RefreshCw, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Convert decimal hours (from API) to H:MM:SS display. */
function formatNptHour(hours) {
  const totalSeconds = Math.round(Number(hours || 0) * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const CATEGORY_ORDER = [
  "Machine & Utility Related",
  "Material Related",
  "Production Related",
];

function buildCategorySummary(rows) {
  const map = new Map();
  for (const row of rows) {
    const cat = row.category || "Other";
    const prev = map.get(cat) || { category: cat, events: 0, totalHours: 0 };
    prev.events += 1;
    prev.totalHours += Number(row.npt_hour || 0);
    map.set(cat, prev);
  }
  return [...map.values()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    if (ai === -1 && bi === -1) return a.category.localeCompare(b.category);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function splitReasons(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function NptReasonModal({ open, row, onClose, onSaved }) {
  const token = useAuthStore((s) => s.accessToken);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    if (open && row) setSelected(new Set(splitReasons(row.npt_reason)));
  }, [open, row]);

  const { data, isLoading } = useQuery({
    queryKey: ["npt-library", row?.category],
    queryFn: () =>
      api
        .get("/automation/npt_library/", { params: { category: row.category } })
        .then((r) => r.data),
    enabled: !!token && open && !!row?.category,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!row?.id) {
        return Promise.reject(new Error("Event not saved yet — wait a moment and retry."));
      }
      if (row.can_confirm_reason === false) {
        return Promise.reject(new Error("NPT must end before confirming reason."));
      }
      return api.patch(`/automation/daily_npt/${row.id}/`, { reasons: Array.from(selected) });
    },
    onSuccess: () => {
      toast.success("NPT reason confirmed");
      onSaved();
    },
    onError: (err) => {
      toast.error(err?.message || err?.response?.data?.detail || "Update failed");
    },
  });

  if (!open || !row) return null;

  const groups = data?.groups ?? [];

  function toggle(reason) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Confirm NPT Reason</h2>
            <p className="text-xs text-slate-500">
              Event #{row.start_log_id} · {row.category} · Machine {row.machin_id} ·{" "}
              {row.start_at}
              {row.stop_at ? ` → ${row.stop_at}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading reasons…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-500">No reasons found for this category.</p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.catogery_id}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.category}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {group.reasons.map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(r.npt_reason)}
                          onChange={() => toggle(r.npt_reason)}
                        />
                        <span className="text-slate-700">{r.npt_reason}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <span className="text-xs text-slate-500">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (selected.size === 0) {
                  toast.error("Select at least one reason");
                  return;
                }
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saveMutation.isPending ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DailyNptList() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const [date, setDate] = useState(todayStr());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editing, setEditing] = useState(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["daily-npt", date],
    queryFn: () =>
      api.get("/automation/daily_npt/", { params: { date } }).then((r) => r.data),
    enabled: !!token && !!date,
    refetchInterval: 15 * 1000,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post("/automation/daily_npt/", { date }),
    onSuccess: (res) => {
      const created = res?.data?.created ?? 0;
      const matched = res?.data?.matched ?? res?.data?.count ?? 0;
      if (created > 0) {
        toast.success(`Synced — ${created} new event(s) for ${date}`);
      }
      qc.invalidateQueries({ queryKey: ["daily-npt", date] });
      return matched;
    },
    onError: () => toast.error("Sync failed"),
  });

  // Sync from sewing_log when date changes so each event appears as its own row.
  useEffect(() => {
    if (!token || !date) return undefined;
    setCategoryFilter("");
    syncMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, date]);

  // Sync + refresh every 15s so new sewing_log rows appear immediately.
  useEffect(() => {
    if (!token || !date) return undefined;
    const tick = () => {
      api
        .post("/automation/daily_npt/", { date })
        .then(() => qc.invalidateQueries({ queryKey: ["daily-npt", date] }))
        .catch(() => {});
    };
    const id = setInterval(tick, 15 * 1000);
    return () => clearInterval(id);
  }, [token, date, qc]);

  const rows = data?.results ?? [];

  const categorySummary = useMemo(() => buildCategorySummary(rows), [rows]);
  const categories = useMemo(
    () => categorySummary.map((s) => s.category),
    [categorySummary]
  );

  const filteredRows = useMemo(() => {
    if (!categoryFilter) return rows;
    return rows.filter((r) => r.category === categoryFilter);
  }, [rows, categoryFilter]);

  const dayTotalHours = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.npt_hour || 0), 0),
    [rows]
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Daily NPT List</h1>
          <p className="mt-1 text-sm text-slate-600">
            One row per NPT event from sewing_log — confirm the reason for each event separately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border-0 bg-transparent p-0 text-slate-900 focus:outline-none focus:ring-0"
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-0 bg-transparent p-0 text-slate-900 focus:outline-none focus:ring-0"
            />
          </label>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sync
          </button>
        </div>
      </header>

      {rows.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Day summary — {date}</h2>
              <p className="text-xs text-slate-500">Category-wise NPT hour total</p>
            </div>
            <div className="rounded-lg bg-slate-900 px-3 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                Total NPT
              </div>
              <div className="font-mono text-lg font-semibold text-white">
                {formatNptHour(dayTotalHours)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categorySummary.map((item) => (
              <button
                key={item.category}
                type="button"
                onClick={() =>
                  setCategoryFilter((prev) => (prev === item.category ? "" : item.category))
                }
                className={`rounded-lg border p-3 text-left transition-colors ${
                  categoryFilter === item.category
                    ? "border-blue-400 bg-blue-50 ring-1 ring-blue-200"
                    : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {item.category}
                </div>
                <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                  {formatNptHour(item.totalHours)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.events} event{item.events !== 1 ? "s" : ""}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Machine</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Floor</th>
              <th className="px-4 py-3">Line</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Event ID</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">NPT Reason</th>
              <th className="px-4 py-3">NPT Hour</th>
              <th className="px-4 py-3">Remarks</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading || (isFetching && rows.length === 0) ? (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-slate-500">
                  No NPT records for {categoryFilter || date}.
                  {categoryFilter ? " Try another category or clear the filter." : " Try Sync."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr
                  key={row.start_log_id || row.id}
                  className={row.is_open ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-3 text-slate-700">{row.date}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{row.machin_id || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.unit || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.floor}</td>
                  <td className="px-4 py-3 text-slate-600">{row.line}</td>
                  <td className="px-4 py-3 text-slate-800">{row.category || "—"}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {row.start_log_id || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.start_at
                      ? row.stop_at
                        ? `${row.start_at} → ${row.stop_at}`
                        : row.is_open
                          ? `${row.start_at} → In progress`
                          : row.start_at
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.npt_reason || "—"}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">
                    {row.is_open ? "—" : formatNptHour(row.npt_hour)}
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-600" title={row.remarks}>
                    {row.remarks || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.is_open || row.can_confirm_reason === false ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800"
                        title="Waiting for NPT to end"
                      >
                        Waiting for end
                      </span>
                    ) : row.npt_reason ? (
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        title="Reason confirmed — click to edit"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirmed
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        disabled={!row.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        Confirm Reason
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NptReasonModal
        open={!!editing}
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["daily-npt", date] });
        }}
      />
    </div>
  );
}
