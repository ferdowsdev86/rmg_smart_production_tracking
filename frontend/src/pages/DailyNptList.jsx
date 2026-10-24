import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, FileSpreadsheet, Filter, ListChecks, RefreshCw, X } from "lucide-react";
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
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (open && row) {
      setSelected(new Set(splitReasons(row.npt_reason)));
      setRemarks(row.remarks || "");
    }
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
      return api.patch(`/automation/daily_npt/${row.id}/`, {
        reasons: Array.from(selected),
        remarks: remarks.trim(),
      });
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[85vh] sm:max-w-lg sm:rounded-xl">
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

        <div className="border-t border-slate-100 px-5 pt-3">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Remarks
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Optional note about this NPT event…"
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="shrink-0 text-xs text-slate-500">{selected.size} selected</span>
          <div className="flex flex-1 justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium"
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
              className="min-h-[44px] flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:flex-none"
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
    const base = categoryFilter ? rows.filter((r) => r.category === categoryFilter) : rows;
    // "Waiting for end" (still-running NPT) rows always on top
    const waiting = (r) => (r.is_open || r.can_confirm_reason === false ? 0 : 1);
    return [...base].sort((a, b) => waiting(a) - waiting(b));
  }, [rows, categoryFilter]);

  const dayTotalHours = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.npt_hour || 0), 0),
    [rows]
  );

  function exportExcel() {
    const esc = (v) => String(v ?? "").replace(/</g, "&lt;");
    const status = (r) =>
      r.is_open || r.can_confirm_reason === false
        ? "Waiting for end"
        : r.npt_reason
          ? "Confirmed"
          : "Pending reason";
    const bodyRows = filteredRows
      .map(
        (r) =>
          `<tr><td>${esc(r.date)}</td><td>${esc(r.machin_id)}</td><td>${esc(r.unit)}</td><td class="c">${esc(r.floor)}</td><td class="c">${esc(r.line)}</td><td>${esc(r.category)}</td><td>${esc(r.start_log_id)}</td><td>${esc(r.start_at)}</td><td>${r.is_open ? "In progress" : esc(r.stop_at)}</td><td>${esc(r.npt_reason)}</td><td class="c">${r.is_open ? "" : formatNptHour(r.npt_hour)}</td><td>${esc(r.remarks)}</td><td>${status(r)}</td></tr>`,
      )
      .join("");
    const sumRows = categorySummary
      .map((x) => `<tr><td>${esc(x.category)}</td><td class="c">${x.events}</td><td class="c">${formatNptHour(x.totalHours)}</td></tr>`)
      .join("");
    const html = `<html><head><meta charset="utf-8"><title>Daily NPT ${date}</title>
<style>body{font-family:Arial,sans-serif}h1{font-size:16px;margin:0}h2{font-size:13px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #94a3b8;padding:3px 6px;text-align:left}th{background:#f1f5f9;text-transform:uppercase;font-size:9.5px}td.c{text-align:center}</style>
</head><body>
<h1>MBM Group — Daily NPT Report (${date})</h1>
<h2>Summary — Total NPT ${formatNptHour(dayTotalHours)}</h2>
<table><thead><tr><th>Category</th><th>Events</th><th>NPT Hour</th></tr></thead><tbody>${sumRows}</tbody></table>
<h2>Details${categoryFilter ? ` — ${esc(categoryFilter)}` : ""}</h2>
<table><thead><tr><th>Date</th><th>Machine</th><th>Unit</th><th>Floor</th><th>Line</th><th>Category</th><th>Event ID</th><th>Start</th><th>Stop</th><th>NPT Reason</th><th>NPT Hour</th><th>Remarks</th><th>Status</th></tr></thead>
<tbody>${bodyRows}</tbody></table>
</body></html>`;
    const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daily_npt_${date}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function renderAction(row, full = false) {
    const base = `inline-flex items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
      full ? "w-full justify-center py-2.5 text-[13px]" : "py-1.5"
    }`;
    if (row.is_open || row.can_confirm_reason === false) {
      return (
        <span className={`${base} border border-amber-200 bg-amber-100 text-amber-800`} title="Waiting for NPT to end">
          Waiting for end
        </span>
      );
    }
    if (row.npt_reason) {
      return (
        <button
          type="button"
          onClick={() => setEditing(row)}
          title="Reason confirmed — click to edit"
          className={`${base} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Confirmed
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setEditing(row)}
        disabled={!row.id}
        className={`${base} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50`}
      >
        <ListChecks className="h-3.5 w-3.5" />
        Confirm Reason
      </button>
    );
  }

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
          <button
            type="button"
            onClick={exportExcel}
            disabled={filteredRows.length === 0}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel
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

      {/* mobile: smart card list */}
      <div className="space-y-2.5 md:hidden">
        {isLoading || (isFetching && rows.length === 0) ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            No NPT records for {categoryFilter || date}.
          </div>
        ) : (
          filteredRows.map((row) => (
            <div
              key={row.start_log_id || row.id}
              className={`rounded-xl border p-3 shadow-sm ${
                row.is_open ? "border-amber-300 bg-amber-50/70" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[15px] font-bold text-slate-900">
                    {row.machin_id ? `M${row.machin_id}` : "—"}
                  </span>
                  <span className="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {row.category || "—"}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[15px] font-bold text-slate-900">
                  {row.is_open ? "running" : formatNptHour(row.npt_hour)}
                </span>
              </div>
              <div className="mt-1 text-[12px] tabular-nums text-slate-500">
                {row.start_at
                  ? `${row.start_at} → ${row.is_open ? "In progress" : row.stop_at || "—"}`
                  : "—"}
                {row.start_log_id ? ` · #${row.start_log_id}` : ""}
              </div>
              {row.npt_reason ? (
                <div className="mt-1 text-[12.5px] font-semibold text-slate-700">{row.npt_reason}</div>
              ) : null}
              {row.remarks ? (
                <div className="mt-0.5 text-[12px] text-slate-500">📝 {row.remarks}</div>
              ) : null}
              <div className="mt-2.5">{renderAction(row, true)}</div>
            </div>
          ))
        )}
      </div>

      {/* desktop: full table */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
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
                  <td className="px-4 py-3 text-right">{renderAction(row)}</td>
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
