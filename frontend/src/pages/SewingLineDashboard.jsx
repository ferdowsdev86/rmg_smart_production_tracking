import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, RefreshCw } from "lucide-react";

import { CardSkeleton } from "../components/LoadingSkeleton";
import { SewingLineBoard } from "../components/sewing/SewingLineBoard";
import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function SewingLineDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const [logDate, setLogDate] = useState(() => localDateString());

  const { data: lineList, isLoading: linesLoading, isError: linesError } = useQuery({
    queryKey: ["sewing-lines"],
    queryFn: () => api.get("/automation/sewing-lines/").then((r) => r.data),
    enabled: !!token,
    retry: (count, err) => err?.response?.status !== 401 && count < 2,
  });

  const lines = lineList?.lines ?? [];
  const [selected, setSelected] = useState(null);

  const active = useMemo(() => {
    if (selected) return selected;
    if (lines.length) return lines[0];
    return null;
  }, [selected, lines]);

  const isToday = logDate === localDateString();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["sewing-line-dashboard", active?.floor, active?.line_no, logDate],
    queryFn: () =>
      api
        .get(`/automation/sewing-lines/${active.floor}/${active.line_no}/dashboard/`, {
          params: { date: logDate },
          timeout: 30_000,
        })
        .then((r) => r.data),
    enabled: !!token && !!active,
    refetchInterval: isToday ? 10_000 : false,
    retry: 1,
  });

  const dashboardBootLoading = !!active && isLoading && !data;

  return (
    <div className="mx-auto max-w-[min(100%,90rem)] space-y-6 px-1">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Sewing line dashboard</h1>
          <p className="text-sm text-slate-600 mt-1">
            GSD-style layout · <code className="text-xs">line_layout</code> + live{" "}
            <code className="text-xs">sewing_log</code>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <Calendar className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <span className="text-slate-600">Log date</span>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="border-0 bg-transparent p-0 text-slate-900 focus:outline-none focus:ring-0 min-w-0"
              aria-label="Filter by sewing_log logged_at date"
            />
          </label>
          {lines.length > 1 ? (
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={active ? `${active.floor}-${active.line_no}` : ""}
              onChange={(e) => {
                const [floor, line_no] = e.target.value.split("-").map(Number);
                setSelected(lines.find((l) => l.floor === floor && l.line_no === line_no));
              }}
            >
              {lines.map((l) => (
                <option key={`${l.floor}-${l.line_no}`} value={`${l.floor}-${l.line_no}`}>
                  {l.label}
                </option>
              ))}
            </select>
          ) : active ? (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
              {active.label}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={!active || isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {linesLoading || dashboardBootLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <CardSkeleton key={i} className="min-w-[148px]" />
            ))}
          </div>
        </div>
      ) : linesError || isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Could not load sewing line dashboard.</p>
          <p className="mt-1 text-red-700">
            {linesError
              ? "Line list failed to load."
              : error?.response?.data?.detail ||
                error?.message ||
                "Request failed — restart Django on port 8001 and refresh."}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-red-800 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      ) : !lines.length ? (
        <p className="text-sm text-slate-600">No rows in <code>line_layout</code> yet.</p>
      ) : (
        <>
          <SewingLineBoard data={data} />
          {data?.generated_at ? (
            <p className="text-xs text-slate-500 text-right">
              Updated {new Date(data.generated_at).toLocaleString()}
              {isToday ? " · auto-refresh 10s" : " · historical day (no auto-refresh)"}
            </p>
          ) : null}
        </>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <Link to="/" className="text-primary font-medium hover:underline">
          ← Back to floor dashboard
        </Link>
      </div>
    </div>
  );
}
