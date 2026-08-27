import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
function StepperStat({ label, value, tone, onMinus, onPlus, minusDisabled, plusDisabled }) {
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
    </div>
  );
}

/** Detail panel for the selected part: stats, +/- defect & reject, machine info. */
function PartDetail({ part, totalPass, defectTypes, onSaved, saveSlot }) {
  // Absolute totals being edited (start from what is stored in DB).
  const [defect, setDefect] = useState(part.defect);
  const [reject, setReject] = useState(part.reject);
  // Selected defect types for THIS save: { sl: qty }
  const [sel, setSel] = useState({});

  useEffect(() => {
    setDefect(part.defect);
    setReject(part.reject);
    setSel({});
  }, [part.barcode, part.defect, part.reject]);

  const chipTotal = Object.values(sel).reduce((a, v) => a + v, 0);
  // Selected defect types drive the DEFECT counter (existing + newly found).
  useEffect(() => {
    if (chipTotal > 0) setDefect(part.defect + chipTotal);
  }, [chipTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bundle qty fully passed already (for this date/style/order/po/color/size
  // group) — no more defect / reject can be recorded.
  const fullyPassed = (totalPass || 0) >= part.qty;
  function blockIfFullyPassed() {
    if (fullyPassed) {
      toast.error("Already total qty was pass");
      return true;
    }
    return false;
  }

  function toggleChip(sl) {
    if (!sel[sl] && blockIfFullyPassed()) return;
    setSel((prev) => {
      const next = { ...prev };
      if (next[sl]) delete next[sl];
      else next[sl] = 1;
      return next;
    });
  }
  function chipQty(sl, delta) {
    if (delta > 0 && blockIfFullyPassed()) return;
    setSel((prev) => {
      const next = { ...prev, [sl]: Math.max(1, (prev[sl] || 1) + delta) };
      return next;
    });
  }

  // Remaining pieces of this part not yet passed today
  const remaining = Math.max(0, part.qty - (totalPass || 0));
  // QC Check = pieces inspected in THIS save (partial check allowed):
  // default all remaining; −/+ to check e.g. 10 of 20 now, the rest later.
  const [checkQty, setCheckQty] = useState(remaining);
  useEffect(() => {
    setCheckQty(remaining);
  }, [part.barcode, remaining]);
  // NEW defects / rejects found in this save (counters are part totals)
  const newDefect = Math.max(0, defect - part.defect);
  const newReject = Math.max(0, reject - part.reject);
  const qcCheck = Math.min(checkQty, remaining);
  const overLimit = newDefect + newReject > qcCheck;
  // pass this save = checked now - new defects - new rejects, but never more
  // than bundle qty - (total pass + defect + reject): pieces still defective
  // (not yet repaired) or rejected can not pass.
  const previewPass = Math.max(
    0,
    Math.min(qcCheck - newDefect - newReject, part.qty - (totalPass || 0) - defect - reject),
  );
  const dirty = defect !== part.defect || reject !== part.reject;

  const saveMutation = useMutation({
    mutationFn: () =>
      api
        .post("/automation/quality/check/", {
          barcode: part.barcode,
          defect,
          reject,
          mode: "set",
          check_qty: qcCheck,
          defects: Object.entries(sel).map(([sl, qty]) => ({ sl: Number(sl), qty })),
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      if (data.qc_saved === false) {
        toast.error(data.warning || "QC history was NOT saved — please save again.");
        return;
      }
      toast.success(
        `${part.part_name}: checked ${data.check_qty ?? qcCheck}, pass ${data.pass_qty}, total pass ${data.total_pass}, defect ${data.defect}, reject ${data.reject}`,
      );
      setSel({});
      onSaved();
    },
    onError: (err) => {
      toast.error(
        err?.response?.data?.detail || err.message || "Failed to save quality check",
      );
    },
  });

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
          onMinus={() => setCheckQty((v) => Math.max(Math.max(1, newDefect + newReject), v - 1))}
          onPlus={() => setCheckQty((v) => Math.min(remaining, v + 1))}
          minusDisabled={qcCheck <= Math.max(1, newDefect + newReject) || saveMutation.isPending}
          plusDisabled={qcCheck >= remaining || saveMutation.isPending}
        />
        <MiniStat label="Total Pass" value={totalPass || 0} tone="sky" />
        <StepperStat
          label="Defect"
          value={defect}
          tone="amber"
          onMinus={() => setDefect((v) => Math.max(0, v - 1))}
          onPlus={() => {
            if (blockIfFullyPassed()) return;
            setDefect((v) => v + 1);
          }}
          minusDisabled={defect <= 0 || saveMutation.isPending}
          plusDisabled={newDefect + newReject >= qcCheck || saveMutation.isPending}
        />
        <StepperStat
          label="Reject"
          value={reject}
          tone="red"
          onMinus={() => setReject((v) => Math.max(0, v - 1))}
          onPlus={() => {
            if (blockIfFullyPassed()) return;
            setReject((v) => v + 1);
          }}
          minusDisabled={reject <= 0 || saveMutation.isPending}
          plusDisabled={newDefect + newReject >= qcCheck || saveMutation.isPending}
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
            {Object.keys(sel).length} defect type · {chipTotal} pcs — DEFECT counter updated automatically
          </div>
        ) : null}
      </div>

      {(() => {
        const saveUi = (
          <div className={saveSlot ? "flex flex-wrap items-center gap-2" : "mt-4 flex flex-wrap items-center gap-3"}>
            <button
              type="button"
              onClick={() => {
                if (overLimit) {
                  toast.error("Defect + reject cannot exceed QC check qty.");
                  return;
                }
                if (defect > part.defect && chipTotal === 0) {
                  toast.error("Please select WHICH defect was found (defect type) before saving.");
                  return;
                }
                saveMutation.mutate();
              }}
              disabled={overLimit || saveMutation.isPending}
              className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-emerald-600 px-7 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {saveMutation.isPending ? "Saving…" : dirty ? "Save" : "Mark QC Pass"}
            </button>
            {dirty ? (
              <>
                <span className="text-xs font-medium text-amber-600">
                  Unsaved changes — defect {part.defect} → {defect}, reject {part.reject} →{" "}
                  {reject}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDefect(part.defect);
                    setReject(part.reject);
                  }}
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                >
                  Reset
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-400">Saved</span>
            )}
          </div>
        );
        return saveSlot ? createPortal(saveUi, saveSlot) : saveUi;
      })()}
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
  // save button portal target: right side of the parts row in the bundle card
  const [saveSlot, setSaveSlot] = useState(null);
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
  }, [bundle?.barcode]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetForNextScan() {
    // After a save: clear everything and get ready for the next bundle scan.
    setBarcode("");
    setBarcodeInput("");
    setOpenPart(null);
    queryClient.removeQueries({ queryKey: ["quality-bundle"] });
    queryClient.invalidateQueries({ queryKey: ["qc-line-totals"] });
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
              {/* Save / Mark QC Pass lands here (portal from PartDetail) */}
              <div ref={setSaveSlot} className="ml-auto flex items-center" />
            </div>
          </div>

          {/* Selected part detail (with machine id where it was scanned) */}
          {selectedPart ? (
            <PartDetail
              part={selectedPart}
              totalPass={selectedPart.total_pass ?? bundle?.total_pass ?? 0}
              defectTypes={defectTypesQ.data || []}
              onSaved={resetForNextScan}
              saveSlot={saveSlot}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
