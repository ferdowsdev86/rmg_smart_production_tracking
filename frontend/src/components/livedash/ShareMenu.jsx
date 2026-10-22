import { useState } from "react";
import { Camera, Download, Link2, Printer, Share2 } from "lucide-react";
import toast from "react-hot-toast";

/** Export / share actions: Print (PDF), CSV of machine-hourly, chart PNG, copy link. */
export default function ShareMenu({ D, mach, date, view, chartRef }) {
  const [open, setOpen] = useState(false);

  function exportCsv() {
    const hours = (D.hourly || []).map((s) => s.hour);
    const head = ["machine", "operator", ...hours.map((h) => `${String(h).padStart(2, "0")}h`), "total", "avg_hr", "eff_pct", "defect", "reject", "npt_min", "status", "action"];
    const lines = [head.join(",")];
    for (const m of mach.machines) {
      lines.push([
        `M${m.mid}`,
        `"${(m.operator || "").replace(/"/g, "'")}"`,
        ...hours.map((h) => Number(m.byHour[String(h)]) || 0),
        m.total,
        Math.round(m.avg),
        Math.round(m.eff),
        m.defect,
        m.reject,
        m.nptMin,
        m.status,
        `"${m.action.replace(/"/g, "'")}"`,
      ].join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `machine_hourly_${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  }

  function chartPng() {
    try {
      const inst = chartRef?.current?.getEchartsInstance?.();
      const url = inst?.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" });
      if (!url) throw new Error("chart not ready");
      const a = document.createElement("a");
      a.href = url;
      a.download = `hourly_chart_${date}.png`;
      a.click();
    } catch {
      toast.error("Chart snapshot not available yet.");
    }
    setOpen(false);
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?date=${date}&view=${view}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy"),
    );
    setOpen(false);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
        <Share2 className="h-3.5 w-3.5" /> Share
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          <MenuItem icon={Printer} label="Print / PDF (A4 landscape)" onClick={() => { setOpen(false); window.print(); }} />
          <MenuItem icon={Download} label="Export machine hourly CSV" onClick={exportCsv} />
          <MenuItem icon={Camera} label="Hourly chart PNG" onClick={chartPng} />
          <MenuItem icon={Link2} label="Copy shareable link" onClick={copyLink} />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
      <Icon className="h-3.5 w-3.5 text-slate-400" /> {label}
    </button>
  );
}
