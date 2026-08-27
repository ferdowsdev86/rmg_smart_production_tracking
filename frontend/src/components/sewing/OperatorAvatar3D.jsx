import { useState } from "react";

/** Operator avatar: HR photo when available, else pseudo-3D silhouette. */
export function OperatorAvatar3D({ status = "offline", operatorId = "", photoUrl = null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showPhoto = photoUrl && !imgFailed;

  if (showPhoto) {
    return (
      <div className="relative mx-auto h-[72px] w-[56px]">
        <div
          className={[
            "h-[72px] w-[56px] overflow-hidden rounded-full shadow-lg ring-2 ring-offset-1",
            status === "present"
              ? "ring-emerald-500"
              : status === "problem"
                ? "ring-red-500"
                : status === "running"
                  ? "ring-blue-500"
                  : "ring-slate-300",
          ].join(" ")}
        >
          <img
            src={photoUrl}
            alt={operatorId ? `Operator ${operatorId}` : "Operator"}
            className="h-full w-full object-cover object-top"
            onError={() => setImgFailed(true)}
          />
        </div>
      </div>
    );
  }

  const glow =
    status === "present"
      ? "from-emerald-400/50 to-emerald-600/20"
      : status === "problem"
        ? "from-red-400/50 to-red-600/20"
        : status === "running"
          ? "from-blue-400/40 to-blue-600/15"
          : status === "idle"
            ? "from-sky-300/30 to-slate-400/10"
            : "from-slate-300/20 to-slate-500/5";

  const initials = operatorId ? String(operatorId).slice(-2).toUpperCase() : "—";

  return (
    <div className="relative mx-auto h-[72px] w-[56px]" style={{ perspective: "420px" }}>
      <div
        className="relative h-full w-full"
        style={{ transform: "rotateY(-14deg) rotateX(6deg)", transformStyle: "preserve-3d" }}
      >
        <div className="absolute inset-x-1 bottom-0 h-3 rounded-full bg-black/20 blur-sm" aria-hidden="true" />
        <div
          className={`absolute left-1/2 top-0 h-[52px] w-[44px] -translate-x-1/2 rounded-[50%] bg-gradient-to-br ${glow} shadow-lg ring-1 ring-white/60`}
        >
          <div className="absolute inset-[6px] rounded-[50%] bg-gradient-to-b from-slate-100 to-slate-300" />
          <div className="absolute left-[10px] top-[18px] h-2 w-2 rounded-full bg-slate-600/70" />
          <div className="absolute right-[10px] top-[18px] h-2 w-2 rounded-full bg-slate-600/70" />
          <div className="absolute bottom-[14px] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-slate-500/40" />
        </div>
        <div className="absolute left-1/2 top-[48px] h-[22px] w-[36px] -translate-x-1/2 rounded-b-2xl rounded-t-md bg-gradient-to-b from-slate-400 to-slate-500 shadow-md" />
        <div className="absolute -bottom-0.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-sidebar text-[9px] font-bold text-white">
          {initials}
        </div>
      </div>
    </div>
  );
}
