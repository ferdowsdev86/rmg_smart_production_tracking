import { useState } from "react";

/** Half head + chest silhouette for line layout plan (or HR photo crop). */
export function PlanOperatorBust({ status = "offline", operatorId = "", photoUrl = null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showPhoto = photoUrl && !imgFailed;

  const ring =
    status === "present"
      ? "ring-emerald-500"
      : status === "problem"
        ? "ring-red-500"
        : status === "running"
          ? "ring-sky-500"
          : "ring-slate-300";

  if (showPhoto) {
    return (
      <div
        className={`mx-auto h-[52px] w-[44px] overflow-hidden rounded-t-[50%] rounded-b-lg shadow-md ring-2 ring-offset-1 ${ring}`}
      >
        <img
          src={photoUrl}
          alt={operatorId ? `Operator ${operatorId}` : "Operator"}
          className="h-full w-full object-cover object-top"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  const glow =
    status === "present"
      ? "from-emerald-300/60 to-emerald-500/30"
      : status === "problem"
        ? "from-red-300/60 to-red-500/30"
        : status === "running"
          ? "from-sky-300/50 to-sky-500/25"
          : "from-slate-200/80 to-slate-400/40";

  const initials = operatorId ? String(operatorId).slice(-2).toUpperCase() : "—";

  return (
    <div className="relative mx-auto h-[58px] w-[48px]" aria-hidden>
      <div
        className={`absolute left-1/2 top-0 h-[34px] w-[34px] -translate-x-1/2 rounded-[50%] bg-gradient-to-br ${glow} shadow ring-1 ring-white/70`}
      >
        <div className="absolute inset-[5px] rounded-[50%] bg-gradient-to-b from-slate-50 to-slate-300" />
        <div className="absolute left-[8px] top-[12px] h-1.5 w-1.5 rounded-full bg-slate-600/60" />
        <div className="absolute right-[8px] top-[12px] h-1.5 w-1.5 rounded-full bg-slate-600/60" />
      </div>
      <div className="absolute left-1/2 top-[30px] h-[22px] w-[40px] -translate-x-1/2 rounded-b-xl rounded-t-md bg-gradient-to-b from-slate-400 to-slate-500 shadow-sm" />
      <div className="absolute -bottom-0.5 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-slate-700 text-[8px] font-bold text-white">
        {initials}
      </div>
    </div>
  );
}
