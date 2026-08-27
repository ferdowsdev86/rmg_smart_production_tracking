import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";

import api from "../lib/api";
import { useCameraAlerts } from "../hooks/useCameraAlerts";
import { useAuthStore } from "../store/useAuthStore";

export default function CameraMonitor() {
  const token = useAuthStore((s) => s.accessToken);
  const [soundOn, setSoundOn] = useState(false);
  const { connected, lastAlert } = useCameraAlerts(!!token);

  const { data: status } = useQuery({
    queryKey: ["camera-status"],
    queryFn: () => api.get("/camera/status/").then((r) => r.data),
    enabled: !!token,
    refetchInterval: 10_000,
  });

  const latestMismatch = useMemo(() => {
    const rows = status?.stations ?? [];
    return rows.find((s) => s.is_mismatch) || null;
  }, [status]);

  useEffect(() => {
    if (!lastAlert) return;
    if (lastAlert.type === "camera.connected") return;
    if (lastAlert.type?.includes("camera") && lastAlert.is_mismatch) {
      toast.error(`Mismatch: ${lastAlert.employee?.name || "Employee"} at wrong station`, {
        duration: 6000,
      });
      if (soundOn) {
        try {
          const ctx = new AudioContext();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.frequency.value = 880;
          g.gain.value = 0.05;
          o.start();
          setTimeout(() => o.stop(), 200);
        } catch {
          /* ignore */
        }
      }
    }
  }, [lastAlert, soundOn]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Camera Monitor</h1>
          <p className="text-sm text-slate-600 mt-1">
            WebSocket: {connected ? "connected" : "disconnected"} · polling status every 10s
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
          Sound alert on mismatch
        </label>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-card">
          <div className="text-sm font-semibold text-slate-900">Latest mismatch (from API)</div>
          {latestMismatch ? (
            <div className="mt-3 text-sm text-slate-700 space-y-1">
              <div>
                <span className="text-slate-500">Station:</span> {latestMismatch.station_label}
              </div>
              <div>
                <span className="text-slate-500">Operator:</span> {latestMismatch.employee_name || "—"} (
                {latestMismatch.emp_id || "—"})
              </div>
              <div>
                <span className="text-slate-500">Confidence:</span> {latestMismatch.confidence}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-600">No active mismatch flags.</div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Auto-resolve when the worker returns to the assigned station (clear flags via new camera events in backend).
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-card">
          <div className="text-sm font-semibold text-slate-900">Last WebSocket payload</div>
          <pre className="mt-2 text-[11px] bg-slate-50 rounded-lg p-3 overflow-auto max-h-56 text-slate-700">
            {JSON.stringify(lastAlert, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
