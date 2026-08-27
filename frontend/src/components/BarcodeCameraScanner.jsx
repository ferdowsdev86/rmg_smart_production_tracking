import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, SwitchCamera, X } from "lucide-react";

const REGION_ID = "qc-barcode-camera";
const FACING_KEY = "qc-camera-facing";

/**
 * Live camera barcode scanner (html5-qrcode). Opens the back camera and
 * fires onDecode(text) once on a successful read.
 *
 * NOTE: browsers only allow camera access on secure origins (HTTPS or
 * localhost) — on plain HTTP the scanner shows a hint instead.
 */
export default function BarcodeCameraScanner({ open, onDecode, onClose, onUnavailable }) {
  const scannerRef = useRef(null);
  const decodedRef = useRef(false);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  // "environment" = back camera, "user" = front camera. Remembered per device.
  const [facing, setFacing] = useState(
    () => localStorage.getItem(FACING_KEY) || "environment",
  );

  function toggleFacing() {
    const next = facing === "environment" ? "user" : "environment";
    localStorage.setItem(FACING_KEY, next);
    setFacing(next);
  }

  const secureOrigin =
    typeof window !== "undefined" &&
    (window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const httpsUrl =
    typeof window !== "undefined"
      ? `https://${window.location.hostname}:9443${window.location.pathname}`
      : "";

  useEffect(() => {
    if (!open) return undefined;
    if (!secureOrigin) {
      setError("insecure-origin");
      if (onUnavailable) setTimeout(() => onUnavailable("insecure"), 0);
      return undefined;
    }

    let cancelled = false;
    decodedRef.current = false;
    setError(null);
    setStarting(true);

    let scanner;
    try {
      scanner = new Html5Qrcode(REGION_ID, { verbose: false });
    } catch (err) {
      setStarting(false);
      setError("Camera is not supported on this device.");
      if (onUnavailable) setTimeout(() => onUnavailable("missing"), 0);
      return undefined;
    }
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: facing },
        {
          fps: 10,
          qrbox: (w, h) => ({
            width: Math.floor(Math.min(w, 500) * 0.9),
            height: Math.floor(Math.min(h, 500) * 0.45),
          }),
        },
        (text) => {
          if (decodedRef.current) return;
          decodedRef.current = true;
          onDecode((text || "").trim());
        },
        () => {}, // per-frame decode misses — ignore
      )
      .then(() => {
        if (!cancelled) setStarting(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setStarting(false);
          const msg = String(err?.message || err);
          const denied = msg.includes("NotAllowedError") || msg.includes("Permission");
          const missing = msg.includes("NotFoundError") || msg.includes("NotReadableError") || msg.includes("no camera") || msg.includes("Requested device not found");
          setError(
            denied
              ? "Camera permission denied — allow camera access in the browser."
              : `Could not open camera: ${msg}`,
          );
          // No camera on this device (or hard-blocked): tell the page so it
          // stops auto-opening the camera and works scanner-gun/typing only.
          if ((denied || missing) && onUnavailable) setTimeout(() => onUnavailable(denied ? "denied" : "missing"), 0);
        }
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        // html5-qrcode's stop() THROWS synchronously when the camera never
        // actually started (e.g. no camera on the device) — guard everything.
        try {
          const st = s.stop();
          if (st && typeof st.then === "function") {
            st.then(() => s.clear()).catch(() => {});
          }
        } catch (e) {
          try {
            s.clear();
          } catch (e2) {
            /* nothing left to clean */
          }
        }
      }
    };
  }, [open, secureOrigin, facing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-900 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5" />
          {starting ? "Opening camera…" : "Point the camera at the bundle barcode"}
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleFacing}
            title="Switch between front and back camera"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-emerald-100 hover:bg-emerald-600"
          >
            <SwitchCamera className="h-3 w-3" />
            {facing === "environment" ? "Back cam" : "Front cam"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-600"
          >
            <X className="h-3 w-3" />
            Close
          </button>
        </span>
      </div>
      {error === "insecure-origin" ? (
        <div className="flex items-center gap-2 rounded-lg bg-slate-800 p-3 text-xs text-amber-300">
          <CameraOff className="h-4 w-4 shrink-0" />
          <span>
            Camera only works on the HTTPS address. Open{" "}
            <a href={httpsUrl} className="font-semibold text-emerald-300 underline">
              {httpsUrl}
            </a>{" "}
            (accept the certificate warning once), or type the barcode manually.
          </span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg bg-slate-800 p-3 text-xs text-amber-300">
          <CameraOff className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}
      <div id={REGION_ID} className="overflow-hidden rounded-lg [&_video]:w-full" />
    </div>
  );
}
