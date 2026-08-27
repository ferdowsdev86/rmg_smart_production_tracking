const DIM_BULB = "bg-slate-400/40 border-slate-500/30 shadow-none";

/** Vertical R/Y/G rail — full height when `fullHeight` (finishing dashboard). */
export function StationTrafficLight({ active = false, isRed = false, fullHeight = false }) {
  const housing = active ? "bg-slate-800 shadow-inner" : "bg-slate-600/90 shadow-inner";
  const bulb = fullHeight ? "h-5 w-5" : "h-3.5 w-3.5";
  const wrap = fullHeight
    ? `flex min-h-full w-[1.75rem] shrink-0 flex-col items-center justify-between self-stretch rounded-lg px-1.5 py-2 ${housing}`
    : `flex flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 ${housing}`;

  if (!active) {
    return (
      <div className={wrap} title="No activity" aria-label="Station inactive">
        <div className={`rounded-full border ${bulb} ${DIM_BULB}`} />
        <div className={`rounded-full border ${bulb} ${DIM_BULB}`} />
        <div className={`rounded-full border ${bulb} ${DIM_BULB}`} />
      </div>
    );
  }

  return (
    <div
      className={wrap}
      title={isRed ? "Workstation problem" : "Workstation OK"}
      aria-label={isRed ? "Problem — red" : "OK — green"}
    >
      <div
        className={[
          `rounded-full border border-slate-900/40 ${bulb}`,
          isRed ? "bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.85)]" : DIM_BULB,
        ].join(" ")}
      />
      <div className={`rounded-full border border-slate-900/40 ${bulb} ${DIM_BULB}`} />
      <div
        className={[
          `rounded-full border border-slate-900/40 ${bulb}`,
          !isRed ? "bg-emerald-500 shadow-[0_0_8px_2px_rgba(16,185,129,0.85)]" : DIM_BULB,
        ].join(" ")}
      />
    </div>
  );
}
