import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { CardSkeleton } from "../components/LoadingSkeleton";
import { FinishingDashboard } from "../components/sewing/FinishingDashboard";
import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function PageToolbar({ filterDate, setFilterDate, floors, activeFloorId, onFloorChange, refetch, isFetching }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={filterDate}
        onChange={(e) => setFilterDate(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold"
        aria-label="Filter date"
      />
      {floors.length > 0 ? (
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold"
          value={activeFloorId ?? ""}
          onChange={(e) => onFloorChange(Number(e.target.value))}
          aria-label="Floor"
        >
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={() => refetch()}
        disabled={!activeFloorId || isFetching}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

export default function LineDiagram() {
  const token = useAuthStore((s) => s.accessToken);

  const { data: floorsData, isLoading: floorsLoading } = useQuery({
    queryKey: ["floors-list"],
    queryFn: () => api.get("/floors/floors/").then((r) => r.data),
    enabled: !!token,
    staleTime: 60_000,
  });

  const floors = floorsData?.floors ?? [];
  const [floorId, setFloorId] = useState(null);
  const activeFloorId = floorId ?? floors[0]?.id ?? null;
  const [filterDate, setFilterDate] = useState(todayIsoDate);

  /** null = all lines (default); number = focus one line */
  const [selectedLineId, setSelectedLineId] = useState(null);
  const showAllLines = selectedLineId == null;

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["finishing-dashboard", activeFloorId, filterDate],
    queryFn: () =>
      api
        .get("/floors/finishing-dashboard/", {
          params: { floor_id: activeFloorId, date: filterDate },
        })
        .then((r) => r.data),
    enabled: !!token && !!activeFloorId,
    staleTime: 30_000,
    refetchInterval: filterDate === todayIsoDate() ? 300_000 : false,
  });

  const lines = useMemo(() => {
    if (dashboard?.lines?.length) return dashboard.lines;
    return dashboard?.line_dashboards?.map((b) => b.line) ?? [];
  }, [dashboard]);

  const loading = floorsLoading || (dashboardLoading && !dashboard);

  const handleFloorChange = (id) => {
    setFloorId(id);
    setSelectedLineId(null);
  };

  if (showAllLines && !loading && lines.length > 0) {
    return (
      <div className="fixed inset-0 z-20 flex flex-col bg-slate-100 md:left-60">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <p className="text-lg font-extrabold text-slate-900">Finishing floor · All lines</p>
          <PageToolbar
            filterDate={filterDate}
            setFilterDate={setFilterDate}
            floors={floors}
            activeFloorId={activeFloorId}
            onFloorChange={handleFloorChange}
            refetch={refetch}
            isFetching={isFetching}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isError ? (
            <p className="p-4 text-sm text-red-600">Could not load finishing dashboard.</p>
          ) : (
            <FinishingDashboard
              dashboard={dashboard}
              lines={lines}
              selectedLineId={selectedLineId}
              onSelectLine={setSelectedLineId}
              fullPage
            />
          )}
        </div>
      </div>
    );
  }

  const showSingleLine = selectedLineId != null;

  return (
    <div className={showSingleLine ? "w-full space-y-2" : "mx-auto w-full max-w-6xl space-y-6"}>
      <header
        className={
          showSingleLine
            ? "flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm"
            : "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        }
      >
        {showSingleLine ? (
          <>
            <p className="text-lg font-extrabold text-slate-900">Finishing line</p>
            <PageToolbar
              filterDate={filterDate}
              setFilterDate={setFilterDate}
              floors={floors}
              activeFloorId={activeFloorId}
              onFloorChange={handleFloorChange}
              refetch={refetch}
              isFetching={isFetching}
            />
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Finishing line</h1>
              <p className="mt-1 text-sm text-slate-600">
                Click a line to enlarge. <span className="font-medium">All lines</span> shows the full floor on one
                screen.
              </p>
            </div>
            <PageToolbar
              filterDate={filterDate}
              setFilterDate={setFilterDate}
              floors={floors}
              activeFloorId={activeFloorId}
              onFloorChange={handleFloorChange}
              refetch={refetch}
              isFetching={isFetching}
            />
          </>
        )}
      </header>

      {loading ? (
        <div className="space-y-4">
          <CardSkeleton className="h-32" />
          <CardSkeleton className="h-[520px]" />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-600">
          Could not load finishing dashboard. Check backend and database tables.
        </p>
      ) : !floors.length ? (
        <p className="text-sm text-slate-600">
          No <code>floors_floor</code> rows. Run{" "}
          <code className="text-xs">python manage.py seed_floor_layout</code>.
        </p>
      ) : !lines.length ? (
        <p className="text-sm text-slate-600">No lines for this floor in <code>floors_line</code>.</p>
      ) : (
        <>
          <FinishingDashboard
            dashboard={dashboard}
            lines={lines}
            selectedLineId={selectedLineId}
            onSelectLine={setSelectedLineId}
            fullPage={false}
          />
          {dashboard?.generated_at ? (
            <p className="text-right text-xs text-slate-500">
              Updated {new Date(dashboard.generated_at).toLocaleString()}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
