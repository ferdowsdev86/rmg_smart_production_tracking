import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Camera, Loader2, Play, Radio, ScanFace } from "lucide-react";

import api from "../../lib/api";
import { useAuthStore } from "../../store/useAuthStore";

const REFRESH_MS = 400;
const CONNECT_TIMEOUT_MS = 45000;

function hasStation(stationId) {
  return stationId !== null && stationId !== undefined && String(stationId) !== "";
}

function appendStationParams(params, stationId, stationNo, zone) {
  if (hasStation(stationId)) {
    params.set("station", String(stationId));
  }
  if (hasStation(stationNo)) {
    params.set("station_no", String(stationNo));
  }
  if (zone !== null && zone !== undefined && String(zone).trim() !== "") {
    params.set("zone", String(zone));
  }
}

function buildSnapshotUrl(accessToken, tick, stationId, stationNo, zone, playback, detect, personLabel, personId) {
  const params = new URLSearchParams();
  if (accessToken) {
    params.set("access", accessToken);
  }
  appendStationParams(params, stationId, stationNo, zone);
  if (playback?.start && playback?.end) {
    params.set("starttime", playback.start);
    params.set("endtime", playback.end);
  }
  if (detect) {
    params.set("detect", "1");
    if (personLabel) {
      params.set("label", personLabel);
    }
    if (personId) {
      params.set("emp", String(personId));
    }
  }
  params.set("t", String(tick));
  return `/api/camera/live/snapshot/?${params.toString()}`;
}

export default function CameraLivePanel({
  dashboardPresent,
  className = "",
  compact = false,
  stationId = null,
  stationNo = null,
  zone = null,
  personLabel = "",
  personId = "",
}) {
  const [configured, setConfigured] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(() => Date.now());
  const [hasFrame, setHasFrame] = useState(false);
  // Playback selection (null = current live feed).
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [playback, setPlayback] = useState(null);
  const [detect, setDetect] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);
  const mountedAt = useRef(Date.now());

  const token =
    accessToken ||
    (typeof window !== "undefined" ? localStorage.getItem("access_token") : null);

  const playbackKey = playback ? `${playback.start}~${playback.end}` : "live";

  useEffect(() => {
    let cancelled = false;
    setConfigured(null);

    const params = new URLSearchParams();
    appendStationParams(params, stationId, stationNo, zone);
    const query = params.toString();

    api
      .get(`/camera/live/config/${query ? `?${query}` : ""}`)
      .then((res) => {
        if (!cancelled) setConfigured(Boolean(res.data?.configured));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stationId, stationNo, zone]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return undefined;
    }

    mountedAt.current = Date.now();
    setLoading(true);
    setError(null);
    setHasFrame(false);

    const pollId = setInterval(() => setTick(Date.now()), REFRESH_MS);
    const timeoutId = setTimeout(() => {
      setLoading(false);
      setError("Camera feed unavailable — no frames received");
    }, CONNECT_TIMEOUT_MS);

    return () => {
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  }, [configured, stationId, stationNo, zone, playbackKey]);

  const imageSrc = useMemo(() => {
    if (!configured) return null;
    return buildSnapshotUrl(token, tick, stationId, stationNo, zone, playback, detect, personLabel, personId);
  }, [configured, token, tick, stationId, stationNo, zone, playback, detect, personLabel, personId]);

  const applyPlayback = () => {
    if (!startInput || !endInput) return;
    setPlayback({ start: startInput, end: endInput });
  };

  const goLive = () => {
    setPlayback(null);
  };

  const isPlayback = Boolean(playback);

  if (configured === false) {
    return (
      <div
        className={[
          "flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-900/80 px-3 py-6 text-center",
          className,
        ].join(" ")}
      >
        <Camera className="mb-2 h-10 w-10 text-slate-600" strokeWidth={1.5} />
        <p className="text-sm font-bold text-slate-300">CCTV feed not configured</p>
        <p className="mt-1 text-xs text-slate-500">
          Dashboard present: <strong className="text-emerald-400">{dashboardPresent}</strong>
        </p>
        <p className="mt-0.5 text-[10px] text-slate-600">Set CAMERA_RTSP_LIVE_URL in server .env</p>
      </div>
    );
  }

  return (
    <div
      className={[
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-700 bg-black",
        className,
      ].join(" ")}
    >
      {!compact ? (
        <div className="absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center gap-1.5 bg-gradient-to-b from-black/85 to-transparent px-2 py-1.5 text-[11px] text-slate-200">
          <button
            type="button"
            onClick={goLive}
            className={[
              "inline-flex items-center gap-1 rounded px-2 py-1 font-bold transition-colors",
              isPlayback
                ? "bg-slate-700/80 text-slate-200 hover:bg-slate-600"
                : "bg-red-600 text-white",
            ].join(" ")}
          >
            <Radio className="h-3.5 w-3.5" /> Live
          </button>
          <input
            type="datetime-local"
            step="1"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            className="rounded border border-slate-600 bg-slate-900/90 px-1.5 py-1 text-slate-100 [color-scheme:dark]"
            aria-label="Playback start"
          />
          <span className="text-slate-400">→</span>
          <input
            type="datetime-local"
            step="1"
            value={endInput}
            onChange={(e) => setEndInput(e.target.value)}
            className="rounded border border-slate-600 bg-slate-900/90 px-1.5 py-1 text-slate-100 [color-scheme:dark]"
            aria-label="Playback end"
          />
          <button
            type="button"
            onClick={applyPlayback}
            disabled={!startInput || !endInput}
            className={[
              "inline-flex items-center gap-1 rounded px-2 py-1 font-bold transition-colors",
              !startInput || !endInput
                ? "cursor-not-allowed bg-slate-800 text-slate-500"
                : isPlayback
                  ? "bg-sky-600 text-white hover:bg-sky-500"
                  : "bg-sky-700 text-white hover:bg-sky-600",
            ].join(" ")}
          >
            <Play className="h-3.5 w-3.5" /> Playback
          </button>
          <button
            type="button"
            onClick={() => setDetect((v) => !v)}
            title="Detect faces in the frame (detection only, not identity-verified)"
            className={[
              "inline-flex items-center gap-1 rounded px-2 py-1 font-bold transition-colors",
              detect ? "bg-amber-500 text-slate-900" : "bg-slate-700/80 text-slate-200 hover:bg-slate-600",
            ].join(" ")}
          >
            <ScanFace className="h-3.5 w-3.5" /> Detect
          </button>
        </div>
      ) : null}

      {loading && !hasFrame ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-900/90">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          <p className="text-xs text-slate-500">
            {isPlayback ? "Loading recorded footage…" : "Connecting to camera…"}
          </p>
        </div>
      ) : null}

      {error && !hasFrame ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-3 py-6 text-center">
          <AlertCircle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-semibold text-amber-200">{error}</p>
          <p className="text-[10px] text-slate-500">Check RTSP URL and that the API server can reach the camera</p>
        </div>
      ) : null}

      {imageSrc ? (
        <img
          src={imageSrc}
          alt={isPlayback ? "Recorded CCTV" : "Live CCTV"}
          className="h-full w-full flex-1 object-contain"
          draggable={false}
          onLoad={() => {
            setHasFrame(true);
            setLoading(false);
            setError(null);
          }}
        />
      ) : null}

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2 py-1 text-[9px] text-slate-300">
        <span className="inline-flex items-center gap-1">
          {isPlayback ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              PLAYBACK
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              LIVE
            </>
          )}
        </span>
        {!compact ? (
          <span>
            Present: <strong className="text-emerald-400">{dashboardPresent}</strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}
