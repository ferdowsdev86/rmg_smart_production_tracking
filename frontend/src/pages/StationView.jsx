import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";

import { OperationIcon } from "../components/OperationIcon";
import { CardSkeleton } from "../components/LoadingSkeleton";
import api from "../lib/api";
import { efficiencyTone } from "../lib/colors";
import { useLineSocket } from "../hooks/useLineSocket";
import { useAuthStore } from "../store/useAuthStore";

const STATUS_LABEL = {
  normal: "🟢 Normal",
  behind: "🟡 Behind",
  alert: "🔴 Alert",
  empty: "⚪ Empty",
};

export default function StationView() {
  const token = useAuthStore((s) => s.accessToken);
  const [params, setParams] = useSearchParams();
  const lineIdParam = params.get("lineId");

  const { data: linesData } = useQuery({
    queryKey: ["lines"],
    queryFn: () => api.get("/floors/lines/").then((r) => r.data),
    enabled: !!token,
  });

  const lines = linesData ?? [];
  const activeLineId = lineIdParam || (lines[0]?.id ? String(lines[0].id) : null);

  const { data: stationPayload, isLoading } = useQuery({
    queryKey: ["line-stations", activeLineId],
    queryFn: () => api.get(`/floors/lines/${activeLineId}/stations/`).then((r) => r.data),
    enabled: !!token && !!activeLineId,
  });

  useLineSocket(activeLineId ? Number(activeLineId) : null, !!token && !!activeLineId);

  const [modal, setModal] = useState(null);

  const { data: hourly } = useQuery({
    queryKey: ["hourly", activeLineId, modal?.id],
    queryFn: () =>
      api
        .get("/reports/hourly/", { params: { line_id: activeLineId, date: stationPayload?.date } })
        .then((r) => r.data),
    enabled: !!token && !!activeLineId && !!modal,
  });

  const chartOption = useMemo(() => {
    const hours = hourly?.hours ?? [];
    return {
      grid: { left: 40, right: 16, top: 24, bottom: 32 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: hours.map((h) => `${h.hour}:00`) },
      yAxis: { type: "value" },
      series: [
        {
          name: "Quantity",
          type: "bar",
          data: hours.map((h) => h.quantity),
          itemStyle: { color: "#2563EB" },
        },
        {
          name: "Target",
          type: "line",
          data: hours.map((h) => h.target),
          smooth: true,
          itemStyle: { color: "#F59E0B" },
        },
      ],
    };
  }, [hourly]);

  const stations = stationPayload?.stations ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Station View</h1>
          <p className="text-sm text-slate-600 mt-1">Up to 50 stations per line with live status.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">Line</label>
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={activeLineId ?? ""}
            onChange={(e) => setParams({ lineId: e.target.value })}
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {stations.map((s) => {
            const tone = efficiencyTone(s.efficiency_pct ?? 0);
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => setModal(s)}
                className="text-left rounded-2xl bg-white p-3 shadow-card border border-slate-100 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-500">#{s.station_number}</div>
                  <OperationIcon operationType={s.operation_type} className="h-4 w-4 text-slate-700" />
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900 line-clamp-1">
                  {s.operation_label}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {s.profile_image ? (
                    <img
                      src={s.profile_image}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-800 truncate">
                      {s.employee_name || "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">{s.output_today} / {s.target_today}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-600">{STATUS_LABEL[s.status] || s.status}</span>
                  <span className={`text-[11px] font-semibold ${tone.text}`}>{s.efficiency_pct}%</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-slate-500">Station {modal.station_number}</div>
                <div className="text-lg font-semibold text-slate-900">{modal.operation_label}</div>
                <div className="text-xs text-slate-600 mt-1">
                  SAM {modal.standard_time} min · Skill L{modal.required_skill_level}
                </div>
              </div>
              <button
                type="button"
                className="text-sm text-slate-500 hover:text-slate-800"
                onClick={() => setModal(null)}
              >
                Close
              </button>
            </div>
            <div className="p-5 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-2">Operator</div>
                <div className="flex items-center gap-3">
                  {modal.profile_image ? (
                    <img src={modal.profile_image} alt="" className="h-14 w-14 rounded-xl object-cover border" />
                  ) : (
                    <div className="h-14 w-14 rounded-xl bg-slate-100 border" />
                  )}
                  <div>
                    <div className="font-medium text-slate-900">{modal.employee_name || "Unassigned"}</div>
                    <div className="text-xs text-slate-500">{modal.employee_emp_id || "—"}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-page p-3 text-sm text-slate-700">
                <div className="flex justify-between"><span>Efficiency</span><span className="font-semibold">{modal.efficiency_pct}%</span></div>
                <div className="flex justify-between mt-2"><span>Output / target</span><span>{modal.output_today} / {modal.target_today}</span></div>
                <div className="text-xs text-slate-500 mt-2">Idle time not tracked in this scaffold.</div>
              </div>
            </div>
            <div className="px-5 pb-5">
              <div className="text-xs font-semibold text-slate-700 mb-2">Hourly production</div>
              <div className="h-64">
                <ReactECharts option={chartOption} style={{ height: "100%" }} notMerge lazyUpdate />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
