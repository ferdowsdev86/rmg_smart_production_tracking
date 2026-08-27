import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Wrench, Plus, CheckCircle2 } from "lucide-react";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";
import { MachineMaintenanceModal, formatMaintenanceRemarks } from "../components/maintenance/MachineMaintenanceModal";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyMachineMaintenance() {
  const token = useAuthStore((s) => s.accessToken);
  const [date, setDate] = useState(todayStr());
  const [modalSource, setModalSource] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["daily-machine-maintenance-derived", date],
    queryFn: () =>
      api
        .get("/floors/daily-machin-maintanance/derived/", { params: { date } })
        .then((r) => r.data),
    enabled: !!token && !!date,
  });

  const rows = data?.results ?? [];

  // Saved maintenance entries for this date. Key starts with
  // "daily-machin-maintanance" so the modal's invalidation refreshes it.
  const { data: savedRows = [] } = useQuery({
    queryKey: ["daily-machin-maintanance", date],
    queryFn: () =>
      api
        .get("/floors/daily-machin-maintanance/", { params: { date } })
        .then((r) => r.data),
    enabled: !!token && !!date,
  });

  // machine_id -> latest saved entry (rows come newest-first from the API).
  const savedByMachine = useMemo(() => {
    const map = new Map();
    for (const r of savedRows) {
      if (!map.has(r.machine_id)) map.set(r.machine_id, r);
    }
    return map;
  }, [savedRows]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Daily Machine Maintenance</h1>
          <p className="mt-1 text-sm text-slate-600">
            Machine &amp; utility events derived from sewing_log (flag4), date-wise and
            machine-wise.
          </p>
        </div>
        <label className="flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-0 bg-transparent p-0 text-slate-900 focus:outline-none focus:ring-0"
          />
        </label>
      </header>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Machine</th>
              <th className="px-4 py-3 text-right">Events</th>
              <th className="px-4 py-3">First seen</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3">Remarks</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  No machine maintenance events (flag4) for {date}.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const saved = savedByMachine.get(row.machin_id);
                return (
                <tr key={row.machin_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{row.date}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <span className="inline-flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-slate-400" />#{row.machin_id}
                      {row.machin_name ? ` · ${row.machin_name}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {row.count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.first_seen || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{row.last_seen || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {saved?.remarks ? (
                      <span
                        className="block max-w-xs truncate"
                        title={formatMaintenanceRemarks(saved.remarks)}
                      >
                        {formatMaintenanceRemarks(saved.remarks)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {saved ? (
                      <button
                        type="button"
                        onClick={() => setModalSource({ ...row, saved })}
                        title="Maintenance entry recorded — click to edit"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Completed
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setModalSource(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Action
                      </button>
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <MachineMaintenanceModal
        open={!!modalSource}
        source={modalSource}
        onClose={() => setModalSource(null)}
      />
    </div>
  );
}
