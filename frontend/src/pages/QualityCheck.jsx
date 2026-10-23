import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Barcode,
  CheckCircle2,
  ClipboardX,
  Cpu,
  PackageSearch,
  Puzzle,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import toast from "react-hot-toast";

import api from "../lib/api";
import BarcodeCameraScanner from "../components/BarcodeCameraScanner";
import { useAuthStore } from "../store/useAuthStore";

function InfoField({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800 break-words">
        {value ?? "—"}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
  };
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${tones[tone] || tones.slate}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold leading-tight">{value}</div>
    </div>
  );
}

/** Stat card with +/- stepper buttons (used for Defect and Reject). */
function StepperStat({ label, value, tone, onMinus, onPlus, minusDisabled, plusDisabled, sub }) {
  const tones = {
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  };
  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-bold shadow ring-1 ring-slate-200 transition hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100";
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${tones[tone] || tones.amber}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 flex items-center justify-center gap-3">
        <button type="button" onClick={onMinus} disabled={minusDisabled} className={btn}>
          −
        </button>
        <span className="min-w-9 text-xl font-bold leading-tight">{value}</span>
        <button type="button" onClick={onPlus} disabled={plusDisabled} className={btn}>
          +
        </button>
      </div>
      {sub ? (
        <div className="mt-1 inline-block rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-extrabold ring-1 ring-current/20">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** Detail panel for the selected part: stats, +/- defect & reject, machine info.
 *  Fully CONTROLLED: all edits (defect/reject/checkQty/selected defect types)
 *  live in the parent per part barcode, so switching parts keeps selections
 *  until Save or Cancel. */
function PartDetail({
  part,
  totalPass,
  defectTypes,
  edit,
  onEdit,
  saving,
  bundleView = null,
  sessionD = 0,
  sessionR = 0,
  setSessionD,
  setSessionR,
}) {
  const sel = edit.sel || {};

  const chipTotal = Object.values(sel).reduce((a, v) => a + v, 0);

  // Bundle qty fully passed already (through any part) — no more
  // defect / reject can be recorded.
  const fullyPassed = (bundleView?.pass ?? totalPass ?? 0) >= part.qty;
  function blockIfFullyPassed() {
    if (fullyPassed) {
      toast.error("Already total qty was pass");
      return true;
    }
    return false;
  }

  function toggleChip(sl) {
    if (!sel[sl] && blockIfFullyPassed()) return;
    const next = { ...sel };
    if (next[sl]) delete next[sl];
    else next[sl] = 1;
    onEdit({ sel: next });
  }
  function chipQty(sl, delta) {
    if (delta > 0 && blockIfFullyPassed()) return;
    onEdit({ sel: { ...sel, [sl]: Math.max(1, (sel[sl] || 1) + delta) } });
  }

  // Remaining pieces of this part not yet passed today
  const remaining = Math.max(0, part.qty - (totalPass || 0));
  // QC Check = pieces inspected in THIS save (partial check allowed):
  // default all remaining; −/+ to check e.g. 10 of 20 now, the rest later.
  const checkQty = edit.checkQty ?? remaining;
  // NEW defects / rejects of this save session (ONE count for every part)
  const newDefect = sessionD;
  const newReject = sessionR;
  const qcCheck = Math.min(checkQty, remaining);
  const overLimit = newDefect + newReject > qcCheck;
  const previewPass = Math.max(
    0,
    Math.min(
      qcCheck - newDefect - newReject,
      (bundleView?.remaining ?? remaining) - newDefect - newReject,
    ),
  );
  const dirty = chipTotal > 0;

  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-emerald-300">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Puzzle className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-semibold uppercase text-slate-800">
          {part.part_name}
        </span>
        {part.scanned ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Scanned
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            Not scanned
          </span>
        )}
        {part.defect + part.reject > 0 ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            Checked
          </span>
        ) : null}
        {/* Machine(s) where THIS part was scanned */}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {(part.stations || []).map((s) => (
            <span
              key={`${s.machin_id}-${s.date}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white"
            >
              <Cpu className="h-3 w-3" />
              Machine {s.machin_id}
              <span className="font-normal text-slate-300">
                · floor {s.floor} · line {s.line} · {s.date || "—"}
              </span>
            </span>
          ))}
        </span>
      </div>

      {fullyPassed ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-700 ring-1 ring-rose-200">
          ⚠️ Already total qty was pass — defect / reject can not be recorded.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StepperStat
          label="QC Check"
          value={qcCheck}
          tone="slate"
          onMinus={() => onEdit({ checkQty: Math.max(Math.max(1, newDefect + newReject), qcCheck - 1) })}
          onPlus={() => onEdit({ checkQty: Math.min(remaining, qcCheck + 1) })}
          minusDisabled={qcCheck <= Math.max(1, newDefect + newReject) || saving}
          plusDisabled={qcCheck >= remaining || saving}
        />
        <MiniStat label="Total Pass" value={bundleView?.pass ?? totalPass ?? 0} tone="sky" />
        <StepperStat
          label="Defect"
          value={bundleView ? bundleView.defect : sessionD}
          tone="amber"
          onMinus={() => setSessionD?.((v) => Math.max(0, v - 1))}
          onPlus={() => {
            if (blockIfFullyPassed()) return;
            setSessionD?.((v) => v + 1);
          }}
          minusDisabled={sessionD <= 0 || saving}
          plusDisabled={newDefect + newReject >= qcCheck || saving}
        />
        <StepperStat
          label="Reject"
          value={bundleView ? bundleView.reject : sessionR}
          tone="red"
          onMinus={() => setSessionR?.((v) => Math.max(0, v - 1))}
          onPlus={() => {
            if (blockIfFullyPassed()) return;
            setSessionR?.((v) => v + 1);
          }}
          minusDisabled={sessionR <= 0 || saving}
          plusDisabled={newDefect + newReject >= qcCheck || saving}
        />
        <MiniStat label="Pass" value={previewPass} tone="green" />
      </div>

      {/* defect type selection from qc_diffect */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Defect type — select which defect(s) were found
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {(defectTypes || []).map((d) => {
            const on = sel[d.sl] != null;
            return (
              <div
                key={d.sl}
                onClick={() => toggleChip(d.sl)}
                className={`flex min-h-[46px] cursor-pointer select-none items-center gap-2 rounded-xl px-2.5 py-1.5 ring-1 transition active:scale-[0.98] ${
                  on
                    ? "bg-amber-500 text-white ring-amber-600 shadow-md"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-amber-50 hover:ring-amber-300"
                }`}
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold ${on ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>
                  {d.sl}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`mr-1.5 rounded px-1 py-0.5 text-[10px] font-bold ${on ? "bg-white/25" : "bg-slate-100 text-slate-500"}`}>
                    {d.defect_code}
                  </span>
                  <span className="text-[13px] font-semibold leading-tight">{d.defect_name}</span>
                </span>
                {on ? (
                  <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => chipQty(d.sl, -1)}
                      className="grid h-9 w-9 place-items-center rounded-full bg-white/25 text-lg font-bold leading-none active:scale-90"
                    >
                      −
                    </button>
                    <b className="min-w-6 text-center text-[16px]">{sel[d.sl]}</b>
                    <button
                      type="button"
                      onClick={() => chipQty(d.sl, 1)}
                      className="grid h-9 w-9 place-items-center rounded-full bg-white/25 text-lg font-bold leading-none active:scale-90"
                    >
                      +
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {chipTotal > 0 ? (
          <div className="mt-1.5 text-[11px] font-semibold text-amber-600">
            {Object.keys(sel).length} defect type · {chipTotal} pcs selected on {part.part_name} — the DEFECT / REJECT
            counts above apply to EVERY selected part on save. Selections are kept when you open another part.
          </div>
        ) : null}
        {overLimit ? (
          <div className="mt-1.5 text-[11px] font-bold text-rose-600">
            Defect + reject cannot exceed QC check qty.
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {dirty ? (
          <>
            <span className="text-xs font-medium text-amber-600">
              Unsaved — {chipTotal} defect pcs selected on {part.part_name}
            </span>
            <button
              type="button"
              onClick={() => onEdit({ sel: {}, checkQty: remaining })}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              Reset this part
            </button>
          </>
        ) : (
          <span className="text-xs text-slate-400">No defect type selected on this part</span>
        )}
      </div>
    </div>
  );
}

export default function QualityCheck() {
  const token = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcode, setBarcode] = useState("");
  const [openPart, setOpenPart] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Per-part unsaved edits: { [partBarcode]: {sel, checkQty} } — kept across
  // part switches until Save or Cancel. The Defect/Reject counts are ONE
  // session-level pair applied to every part with selections on save.
  const [edits, setEdits] = useState({});
  const [sessionD, setSessionD] = useState(0);
  const [sessionR, setSessionR] = useState(0);
  const [saving, setSaving] = useState(false);
  // null = unknown yet; false = no usable camera (device w/o camera, blocked,
  // or insecure origin) -> barcode-gun / manual typing mode only.
  const [cameraOk, setCameraOk] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    let alive = true;
    try {
      const secure =
        window.isSecureContext ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      if (!secure || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setCameraOk(false);
        return () => { alive = false; };
      }
      navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => {
          if (alive) setCameraOk(devs.some((d) => d.kind === "videoinput"));
        })
        .catch(() => alive && setCameraOk(false));
    } catch (e) {
      setCameraOk(false);
    }
    return () => { alive = false; };
  }, []);

  const lineTotalsQ = useQuery({
    queryKey: ["qc-line-totals"],
    queryFn: () => api.get("/reports/quality/").then((r) => r.data),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const defectTypesQ = useQuery({
    queryKey: ["qc-defect-types"],
    queryFn: () => api.get("/automation/quality/defect_types/").then((r) => r.data.defects || []),
    enabled: !!token,
    staleTime: 10 * 60 * 1000,
  });

  const bundleQuery = useQuery({
    queryKey: ["quality-bundle", barcode],
    queryFn: () =>
      api
        .get("/automation/quality/bundle/", { params: { barcode } })
        .then((r) => r.data),
    enabled: !!token && !!barcode,
    retry: false,
  });

  const bundle = bundleQuery.data;

  // Gun-scan mode: keep the scan field focused so the next gun read lands
  // in it (only when there is no camera to open).
  useEffect(() => {
    if (cameraOk === false && !bundleQuery.isFetching) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [cameraOk, bundleQuery.isFetching, bundle?.barcode]);

  useEffect(() => {
    // Auto-select the scanned barcode's part (only if it is QC-able).
    if (bundle?.found) {
      const own = bundle.parts?.find((p) => p.barcode === bundle.barcode);
      setOpenPart(own?.barcode ?? bundle.parts?.[0]?.barcode ?? null);
    }
    setEdits({});
    setSessionD(0);
    setSessionR(0);
  }, [bundle?.barcode]); // eslint-disable-line react-hooks/exhaustive-deps

  const partTotalPass = (p) => p.total_pass ?? bundle?.total_pass ?? 0;
  // Bundle-level pass: the garments of this bundle checked through ANY part.
  const bundlePass = bundle?.parts?.length
    ? Math.max(0, ...bundle.parts.map((p) => p.total_pass ?? 0), bundle.total_pass ?? 0)
    : 0;
  const bundleRemaining = Math.max(0, (bundle?.qty || 0) - bundlePass);
  const getEdit = (p) => ({
    sel: {},
    checkQty: Math.min(Math.max(0, p.qty - partTotalPass(p)), bundleRemaining),
    ...(edits[p.barcode] || {}),
  });
  // ONE manual Defect / Reject count for this save session — it applies to
  // EVERY part that has defect types selected (selecting types never adds).
  const bundleView = bundle?.parts?.length
    ? {
        pass: bundlePass,
        remaining: bundleRemaining,
        defect: bundle.parts.reduce((a, p) => a + (p.defect || 0), 0) + sessionD,
        reject: bundle.parts.reduce((a, p) => a + (p.reject || 0), 0) + sessionR,
      }
    : null;
  const updateEdit = (p, patch) =>
    setEdits((prev) => ({ ...prev, [p.barcode]: { ...getEdit(p), ...patch } }));
  const partChanged = (p) => Object.keys(edits[p.barcode]?.sel || {}).length > 0;

  // Running total of selected (unsaved) defects across ALL parts — the badge
  // next to Mark QC Pass.
  const selSummary = Object.values(edits).reduce(
    (acc, e) => {
      const sel = e.sel || {};
      const pcs = Object.values(sel).reduce((a, v) => a + v, 0);
      acc.types += Object.keys(sel).length;
      acc.pcs += pcs;
      if (pcs > 0) acc.parts += 1;
      return acc;
    },
    { types: 0, pcs: 0, parts: 0 },
  );
  const hasEdits = (bundle?.parts || []).some((p) => partChanged(p)) || sessionD > 0 || sessionR > 0;

  async function saveAll() {
    const parts = bundle?.parts || [];
    const changed = parts.filter(partChanged);
    const selectedPartNow = parts.find((p) => p.barcode === openPart) || null;
    // the session Defect/Reject count applies to EVERY part with selected
    // defect types; with no selections it falls back to the open part
    const targets = changed.length ? changed : selectedPartNow ? [selectedPartNow] : [];
    if (!targets.length) {
      toast.error("Select a part first.");
      return;
    }
    // validate every part before saving anything
    for (const p of targets) {
      const e = getEdit(p);
      const remaining = Math.max(0, p.qty - partTotalPass(p));
      const qcCheck = Math.min(e.checkQty ?? remaining, remaining);
      if (sessionD + sessionR > qcCheck) {
        toast.error(`${p.part_name}: defect + reject cannot exceed QC check qty.`);
        return;
      }
      if (sessionD > 0 && Object.keys(e.sel || {}).length === 0) {
        toast.error(`${p.part_name}: select WHICH defect was found (defect type).`);
        return;
      }
    }
    setSaving(true);
    try {
      for (const p of targets) {
        const e = getEdit(p);
        const remaining = Math.max(0, p.qty - partTotalPass(p));
        const qcCheck = Math.min(e.checkQty ?? remaining, remaining);
        const { data } = await api.post("/automation/quality/check/", {
          barcode: p.barcode,
          defect: (p.defect || 0) + sessionD,
          reject: (p.reject || 0) + sessionR,
          mode: "set",
          check_qty: qcCheck,
          defects: Object.entries(e.sel || {}).map(([sl, qty]) => ({ sl: Number(sl), qty })),
        });
        if (data.qc_saved === false) {
          toast.error(`${p.part_name}: ${data.warning || "QC history was NOT saved — please save again."}`);
          return;
        }
        toast.success(
          `${p.part_name}: checked ${data.check_qty ?? qcCheck}, pass ${data.pass_qty}, defect ${data.defect}, reject ${data.reject}`,
        );
      }
      resetForNextScan();
    } catch (err) {
      toast.error(err?.response?.data?.detail || err.message || "Failed to save quality check");
    } finally {
      setSaving(false);
    }
  }

  function resetForNextScan() {
    // After a save: clear everything and get ready for the next bundle scan.
    setBarcode("");
    setBarcodeInput("");
    setOpenPart(null);
    setEdits({});
    setSessionD(0);
    setSessionR(0);
    queryClient.removeQueries({ queryKey: ["quality-bundle"] });
    queryClient.invalidateQueries({ queryKey: ["qc-line-totals"] });
    // Live TV / floor boards (same browser + cross-tab via WS on server ping).
    queryClient.invalidateQueries({ queryKey: ["sewing-tv"] });
    queryClient.invalidateQueries({ queryKey: ["floor-overview"] });
    queryClient.invalidateQueries({ queryKey: ["sewing-line-dashboard"] });
    setTimeout(() => inputRef.current?.focus(), 250);
  }

  function handleScan(e) {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;
    setCameraOpen(false);
    setBarcode(code);
  }

  function handleCameraDecode(code) {
    if (!code) return;
    setBarcodeInput(code);
    setCameraOpen(false);
    setBarcode(code);
  }

  function handleInputFocus() {
    // New scan: clear previous barcode text; open camera only when usable.
    setBarcodeInput("");
    if (cameraOk !== false) setCameraOpen(true);
  }

  const notFound = bundleQuery.isError && bundleQuery.error?.response?.status === 404;
  const selectedPart = bundle?.parts?.find((p) => p.barcode === openPart) || null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-emerald-600" />
            Quality Check
          </h1>
          <p className="text-sm text-slate-500">
            Scan a bundle → touch a part → record defect / reject.
          </p>
        </div>
        {(() => {
          const T = lineTotalsQ.data?.totals;
          const label = lineTotalsQ.data?.line_label;
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {label ? (
                <span className="mr-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-bold text-white">
                  Line {label} · Today
                </span>
              ) : null}
              <span className="rounded-xl bg-sky-50 px-3 py-1.5 text-center ring-1 ring-sky-200">
                <span className="block text-[9px] font-extrabold uppercase tracking-wider text-sky-600">Scan</span>
                <b className="text-[17px] leading-tight text-sky-800 tabular-nums">{T ? T.checked : "—"}</b>
              </span>
              <span className="rounded-xl bg-emerald-50 px-3 py-1.5 text-center ring-1 ring-emerald-200">
                <span className="block text-[9px] font-extrabold uppercase tracking-wider text-emerald-600">Pass</span>
                <b className="text-[17px] leading-tight text-emerald-700 tabular-nums">{T ? T.passed : "—"}</b>
              </span>
              <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-center ring-1 ring-amber-200">
                <span className="block text-[9px] font-extrabold uppercase tracking-wider text-amber-600">Defect</span>
                <b className="text-[17px] leading-tight text-amber-700 tabular-nums">{T ? T.defect : "—"}</b>
              </span>
              <span className="rounded-xl bg-rose-50 px-3 py-1.5 text-center ring-1 ring-rose-200">
                <span className="block text-[9px] font-extrabold uppercase tracking-wider text-rose-600">Reject</span>
                <b className="text-[17px] leading-tight text-rose-700 tabular-nums">{T ? T.reject : "—"}</b>
              </span>
              <button
                type="button"
                title="Refresh"
                onClick={() => {
                  lineTotalsQ.refetch();
                  if (barcode) bundleQuery.refetch();
                }}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })()}
      </div>

      {/* 1) Scan block — focus clears the field and opens the camera;
             manual typing + Lookup still works when the camera can't. */}
      <form
        onSubmit={handleScan}
        className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Bundle barcode
        </label>
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onFocus={handleInputFocus}
              placeholder={
                cameraOk === false
                  ? "Ready — scan with barcode/QR scanner gun, or type the code"
                  : "Tap to scan with camera, or type barcode and press Lookup"
              }
              className={`w-full rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none ${
                cameraOk === false
                  ? "border-2 border-emerald-400 bg-emerald-50/50 ring-4 ring-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.25)] focus:border-emerald-500 focus:ring-emerald-200"
                  : "border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              }`}
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Barcode className="h-4 w-4" />
            Lookup
          </button>
        </div>
        <BarcodeCameraScanner
          open={cameraOpen && cameraOk !== false}
          onDecode={handleCameraDecode}
          onClose={() => setCameraOpen(false)}
          onUnavailable={() => {
            setCameraOk(false);
            setCameraOpen(false);
          }}
        />
        {cameraOk === false ? (
          <div className="mt-2 text-[11.5px] font-medium text-slate-400">
            📷 Camera not available on this device — scan with a barcode/QR
            scanner gun or type the code and press Lookup.
          </div>
        ) : null}
      </form>

      {bundleQuery.isFetching ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm ring-1 ring-slate-100">
          Looking up bundle…
        </div>
      ) : null}

      {notFound ? (
        <div className="flex items-center gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-100">
          <ClipboardX className="h-5 w-5" />
          Bundle <span className="font-semibold">{barcode}</span> not found in cutting
          records.
        </div>
      ) : null}

      {bundle?.found ? (
        <>
          {/* 2) Bundle header: style / order / po / size */}
          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <PackageSearch className="h-4 w-4 text-slate-400" />
              Bundle {bundle.bundle_no ?? "—"}
              <span className="text-xs font-normal text-slate-400">
                (barcode {bundle.barcode})
              </span>
              <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                Qty {bundle.qty} pcs
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <InfoField label="Style" value={bundle.style} />
              <InfoField label="Order No" value={bundle.order_no} />
              <InfoField label="PO No" value={bundle.po_no} />
              <InfoField label="Size · Bundle Qty" value={`${bundle.size_no ?? "—"} · ${bundle.qty} pcs`} />
            </div>


            {/* parts live inside the same card — serial row, big touch targets */}
            <div className="mb-2 mt-4 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-700">
              Parts ({bundle.parts?.length || 0}) — touch a part to record quality
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(bundle.parts || []).map((part) => {
                const active = openPart === part.barcode;
                const selPcs = Object.values(edits[part.barcode]?.sel || {}).reduce((a, v) => a + v, 0);
                const base =
                  "inline-flex min-h-[46px] items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold uppercase transition active:scale-95";
                const cls = active
                  ? `${base} bg-emerald-600 text-white shadow`
                  : `${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100`;
                return (
                  <button
                    key={part.barcode}
                    type="button"
                    title={part.scanned ? "Scanned at station" : "Not scanned yet — QC saves under this part's own barcode"}
                    onClick={() => setOpenPart(active ? null : part.barcode)}
                    className={cls}
                  >
                    <Puzzle className="h-3.5 w-3.5" />
                    {part.part_name}
                    {selPcs > 0 ? (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white text-amber-600" : "bg-amber-500 text-white"}`} title="Selected defects (unsaved)">
                        ✎{selPcs}
                      </span>
                    ) : null}
                    {part.defect + part.reject > 0 ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          active
                            ? "bg-white/20 text-white"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        D{part.defect}/R{part.reject}
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {/* Save all parts' selections + running defect badge */}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {selSummary.pcs > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-xl bg-amber-100 px-3 py-2 text-[13px] font-bold text-amber-800 ring-1 ring-amber-300 tabular-nums">
                    {selSummary.pcs} defect
                    <span className="font-semibold text-amber-600">
                      · {selSummary.types} type · {selSummary.parts} part
                    </span>
                  </span>
                ) : null}
                {hasEdits ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEdits({});
                      setSessionD(0);
                      setSessionR(0);
                    }}
                    disabled={saving}
                    className="inline-flex min-h-[46px] items-center rounded-xl bg-slate-100 px-4 py-2.5 text-[14px] font-semibold text-slate-600 hover:bg-slate-200 active:scale-95 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={saveAll}
                  disabled={saving}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-emerald-600 px-7 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {saving ? "Saving…" : hasEdits ? "Save" : "Mark QC Pass"}
                </button>
              </div>
            </div>
          </div>

          {/* Selected part detail (with machine id where it was scanned) */}
          {selectedPart ? (
            <PartDetail
              part={selectedPart}
              totalPass={partTotalPass(selectedPart)}
              defectTypes={defectTypesQ.data || []}
              edit={getEdit(selectedPart)}
              onEdit={(patch) => updateEdit(selectedPart, patch)}
              saving={saving}
              bundleView={bundleView}
              sessionD={sessionD}
              sessionR={sessionR}
              setSessionD={setSessionD}
              setSessionR={setSessionR}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
