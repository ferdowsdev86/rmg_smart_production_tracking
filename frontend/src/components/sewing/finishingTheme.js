/** Process accent strips for neutral card design (status uses separate tokens). */

const ACCENT_STRIPS = [
  "bg-emerald-500",
  "bg-lime-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
  "bg-sky-500",
  "bg-green-500",
  "bg-slate-500",
  "bg-stone-500",
];

export function getProcessAccentClass(process) {
  const order = process?.order ?? process?.display_order ?? 1;
  const idx = Math.max(0, Math.min(ACCENT_STRIPS.length - 1, Number(order) - 1));
  return ACCENT_STRIPS[idx];
}

/** Tailwind class bundles per process (legacy colorful cards). */

const ORDER_THEMES = [
  {
    panel: "bg-emerald-50/90 border-emerald-400",
    titleBar: "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white",
    station: "bg-white/90 border-emerald-200",
    accent: "text-emerald-800",
  },
  {
    panel: "bg-lime-50/90 border-lime-400",
    titleBar: "bg-gradient-to-r from-lime-500 to-lime-600 text-lime-950",
    station: "bg-white/90 border-lime-200",
    accent: "text-lime-900",
  },
  {
    panel: "bg-pink-50/90 border-pink-400",
    titleBar: "bg-gradient-to-r from-pink-500 to-rose-500 text-white",
    station: "bg-white/90 border-pink-200",
    accent: "text-pink-900",
  },
  {
    panel: "bg-teal-50/90 border-teal-400",
    titleBar: "bg-gradient-to-r from-teal-500 to-cyan-600 text-white",
    station: "bg-white/90 border-teal-200",
    accent: "text-teal-900",
  },
  {
    panel: "bg-cyan-50/90 border-cyan-400",
    titleBar: "bg-gradient-to-r from-cyan-500 to-sky-600 text-white",
    station: "bg-white/90 border-cyan-200",
    accent: "text-cyan-900",
  },
  {
    panel: "bg-orange-50/90 border-orange-400",
    titleBar: "bg-gradient-to-r from-orange-500 to-amber-500 text-white",
    station: "bg-white/90 border-orange-200",
    accent: "text-orange-900",
  },
  {
    panel: "bg-rose-50/90 border-rose-400",
    titleBar: "bg-gradient-to-r from-rose-500 to-pink-600 text-white",
    station: "bg-white/90 border-rose-200",
    accent: "text-rose-900",
  },
  {
    panel: "bg-violet-50/90 border-violet-400",
    titleBar: "bg-gradient-to-r from-violet-500 to-purple-600 text-white",
    station: "bg-white/90 border-violet-200",
    accent: "text-violet-900",
  },
  {
    panel: "bg-amber-50/90 border-amber-400",
    titleBar: "bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950",
    station: "bg-white/90 border-amber-200",
    accent: "text-amber-900",
  },
  {
    panel: "bg-indigo-50/90 border-indigo-400",
    titleBar: "bg-gradient-to-r from-indigo-500 to-blue-600 text-white",
    station: "bg-white/90 border-indigo-200",
    accent: "text-indigo-900",
  },
  {
    panel: "bg-fuchsia-50/90 border-fuchsia-400",
    titleBar: "bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white",
    station: "bg-white/90 border-fuchsia-200",
    accent: "text-fuchsia-900",
  },
  {
    panel: "bg-sky-50/90 border-sky-400",
    titleBar: "bg-gradient-to-r from-sky-500 to-blue-500 text-white",
    station: "bg-white/90 border-sky-200",
    accent: "text-sky-900",
  },
  {
    panel: "bg-green-50/90 border-green-400",
    titleBar: "bg-gradient-to-r from-green-500 to-emerald-600 text-white",
    station: "bg-white/90 border-green-200",
    accent: "text-green-900",
  },
  {
    panel: "bg-slate-100/90 border-slate-400",
    titleBar: "bg-gradient-to-r from-slate-600 to-slate-700 text-white",
    station: "bg-white/90 border-slate-200",
    accent: "text-slate-800",
  },
  {
    panel: "bg-stone-100/90 border-stone-400",
    titleBar: "bg-gradient-to-r from-stone-600 to-stone-700 text-white",
    station: "bg-white/90 border-stone-200",
    accent: "text-stone-800",
  },
];

export function getProcessTheme(process) {
  const order = process?.order ?? process?.display_order ?? 1;
  const idx = Math.max(0, Math.min(ORDER_THEMES.length - 1, Number(order) - 1));
  const fallback = ORDER_THEMES[idx];

  if (process?.panel && process?.titleBar) {
    return {
      panel: `${process.panel} shadow-sm`,
      titleBar: process.titleBar,
      station: "bg-white/95 border-slate-200/80 shadow-sm",
      accent: fallback.accent,
    };
  }

  return fallback;
}
