import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Cog,
  KeyRound,
  Layers,
  PauseCircle,
  Wallet,
} from "lucide-react";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function StatCard({ icon: Icon, label, value, tone = "slate", sub }) {
  const tones = {
    slate: "bg-slate-50 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`rounded-lg p-2 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Bar({ value, max, className }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function MachineryDashboard() {
  const token = useAuthStore((s) => s.accessToken);

  const { data, isLoading } = useQuery({
    queryKey: ["machinery-dashboard"],
    queryFn: () => api.get("/floors/machinery-dashboard/").then((r) => r.data),
    enabled: !!token,
  });

  if (isLoading) {
    return <div className="text-sm text-slate-600">Loading machinery dashboard…</div>;
  }
  if (!data) {
    return <div className="text-sm text-slate-600">No data.</div>;
  }

  const { totals, ownership, by_unit: byUnit, maintenance } = data;
  const maxUnitTotal = Math.max(1, ...byUnit.map((u) => u.total));
  const maxMachineTrouble = Math.max(1, ...maintenance.details.map((d) => d.troubles));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Machinery Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Fleet status, ownership, unit-wise distribution, and maintenance trouble summary.
        </p>
      </header>

      {/* Top summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Cog} label="Total Machines" value={totals.total} tone="indigo" />
        <StatCard
          icon={CheckCircle2}
          label="Active"
          value={totals.active}
          tone="emerald"
          sub={`${totals.total ? Math.round((totals.active / totals.total) * 100) : 0}% of fleet`}
        />
        <StatCard icon={PauseCircle} label="Inactive" value={totals.inactive} tone="rose" />
        <StatCard
          icon={AlertTriangle}
          label="Total Troubles"
          value={maintenance.total_troubles}
          tone="amber"
          sub={`${maintenance.machines_with_trouble} machine(s) affected`}
        />
      </div>

      {/* Ownership */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard icon={Wallet} label="Owned" value={ownership.owned} tone="sky" />
        <StatCard icon={KeyRound} label="Rental" value={ownership.rental} tone="amber" />
        <StatCard icon={Building2} label="Units" value={byUnit.length} tone="slate" />
      </div>

      {/* Unit-wise summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-500" />
          <h2 className="text-base font-semibold text-slate-900">Unit-wise summary</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Unit</th>
                <th className="py-2 pr-4">Distribution</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4 text-right">Active</th>
                <th className="py-2 pr-4 text-right">Inactive</th>
                <th className="py-2 pr-4 text-right">Owned</th>
                <th className="py-2 pr-4 text-right">Rental</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byUnit.map((u) => (
                <tr key={u.unit}>
                  <td className="py-3 pr-4 font-medium text-slate-800">{u.unit_label}</td>
                  <td className="py-3 pr-4 w-48">
                    <Bar value={u.total} max={maxUnitTotal} className="bg-indigo-500" />
                  </td>
                  <td className="py-3 pr-4 text-right text-slate-700">{u.total}</td>
                  <td className="py-3 pr-4 text-right text-emerald-600">{u.active}</td>
                  <td className="py-3 pr-4 text-right text-rose-600">{u.inactive}</td>
                  <td className="py-3 pr-4 text-right text-sky-600">{u.owned}</td>
                  <td className="py-3 pr-4 text-right text-amber-600">{u.rental}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Maintenance summary by unit + details */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-base font-semibold text-slate-900">Troubles by unit</h2>
          </div>
          {maintenance.by_unit.length === 0 ? (
            <p className="text-sm text-slate-500">No maintenance records yet.</p>
          ) : (
            <ul className="space-y-3">
              {maintenance.by_unit.map((u) => (
                <li key={u.unit} className="flex items-center justify-between gap-3">
                  <span className="w-24 text-sm text-slate-700">{u.unit_label}</span>
                  <Bar
                    value={u.troubles}
                    max={maintenance.total_troubles}
                    className="bg-amber-500"
                  />
                  <span className="w-8 text-right text-sm font-medium text-slate-800">
                    {u.troubles}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Cog className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">
              Maintenance details — troubles per machine
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Machine</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Unit</th>
                  <th className="py-2 pr-4">Ownership</th>
                  <th className="py-2 pr-4">Trouble count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {maintenance.details.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No maintenance records yet.
                    </td>
                  </tr>
                ) : (
                  maintenance.details.map((d) => (
                    <tr key={d.machine_id}>
                      <td className="py-3 pr-4 font-medium text-slate-800">#{d.machin_no}</td>
                      <td className="py-3 pr-4 text-slate-600">{d.machin_name || "—"}</td>
                      <td className="py-3 pr-4 text-slate-600">{d.unit_label}</td>
                      <td className="py-3 pr-4 text-slate-600">{d.ownership}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Bar
                            value={d.troubles}
                            max={maxMachineTrouble}
                            className="bg-rose-500"
                          />
                          <span className="w-6 text-right font-medium text-slate-800">
                            {d.troubles}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
