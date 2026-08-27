"""UI theme classes for finishing_process rows (by display_order)."""

from __future__ import annotations

ORDER_THEMES: list[dict[str, str]] = [
    {
        "panel": "bg-emerald-50/90 border-emerald-400",
        "title_bar": "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white",
        "tile": "bg-emerald-400 border-emerald-700 text-emerald-950",
        "tile_muted": "bg-emerald-200/70 border-emerald-400 text-emerald-900",
    },
    {
        "panel": "bg-lime-50/90 border-lime-400",
        "title_bar": "bg-gradient-to-r from-lime-500 to-lime-600 text-lime-950",
        "tile": "bg-lime-500 border-lime-700 text-lime-950",
        "tile_muted": "bg-lime-200/70 border-lime-400",
    },
    {
        "panel": "bg-pink-50/90 border-pink-400",
        "title_bar": "bg-gradient-to-r from-pink-500 to-rose-500 text-white",
        "tile": "bg-pink-300 border-pink-500 text-pink-950",
        "tile_muted": "bg-pink-100 border-pink-300",
    },
    {
        "panel": "bg-teal-50/90 border-teal-400",
        "title_bar": "bg-gradient-to-r from-teal-500 to-cyan-600 text-white",
        "tile": "bg-teal-400 border-teal-600 text-teal-950",
        "tile_muted": "bg-teal-200/70 border-teal-400",
    },
    {
        "panel": "bg-cyan-50/90 border-cyan-400",
        "title_bar": "bg-gradient-to-r from-cyan-500 to-sky-600 text-white",
        "tile": "bg-cyan-500 border-cyan-700 text-white",
        "tile_muted": "bg-cyan-200/70 border-cyan-400",
    },
    {
        "panel": "bg-orange-50/90 border-orange-400",
        "title_bar": "bg-gradient-to-r from-orange-500 to-amber-500 text-white",
        "tile": "bg-orange-400 border-orange-600 text-white",
        "tile_muted": "bg-orange-200/70 border-orange-400",
    },
    {
        "panel": "bg-rose-50/90 border-rose-400",
        "title_bar": "bg-gradient-to-r from-rose-500 to-pink-600 text-white",
        "tile": "bg-rose-400 border-rose-600 text-white",
        "tile_muted": "bg-rose-100 border-rose-300",
    },
    {
        "panel": "bg-violet-50/90 border-violet-400",
        "title_bar": "bg-gradient-to-r from-violet-500 to-purple-600 text-white",
        "tile": "bg-violet-400 border-violet-600 text-white",
        "tile_muted": "bg-violet-200/70 border-violet-400",
    },
    {
        "panel": "bg-amber-50/90 border-amber-400",
        "title_bar": "bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950",
        "tile": "bg-amber-400 border-amber-600 text-amber-950",
        "tile_muted": "bg-amber-200/70 border-amber-400",
    },
    {
        "panel": "bg-indigo-50/90 border-indigo-400",
        "title_bar": "bg-gradient-to-r from-indigo-500 to-blue-600 text-white",
        "tile": "bg-indigo-500 border-indigo-700 text-white",
        "tile_muted": "bg-indigo-200/70 border-indigo-400",
    },
    {
        "panel": "bg-fuchsia-50/90 border-fuchsia-400",
        "title_bar": "bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white",
        "tile": "bg-fuchsia-500 border-fuchsia-700 text-white",
        "tile_muted": "bg-fuchsia-200/70 border-fuchsia-400",
    },
    {
        "panel": "bg-sky-50/90 border-sky-400",
        "title_bar": "bg-gradient-to-r from-sky-500 to-blue-500 text-white",
        "tile": "bg-sky-500 border-sky-700 text-white",
        "tile_muted": "bg-sky-200/70 border-sky-400",
    },
    {
        "panel": "bg-green-50/90 border-green-400",
        "title_bar": "bg-gradient-to-r from-green-500 to-emerald-600 text-white",
        "tile": "bg-green-500 border-green-700 text-white",
        "tile_muted": "bg-green-200/70 border-green-400",
    },
    {
        "panel": "bg-slate-100/90 border-slate-400",
        "title_bar": "bg-gradient-to-r from-slate-600 to-slate-700 text-white",
        "tile": "bg-slate-500 border-slate-700 text-white",
        "tile_muted": "bg-slate-300 border-slate-500",
    },
    {
        "panel": "bg-stone-100/90 border-stone-400",
        "title_bar": "bg-gradient-to-r from-stone-600 to-stone-700 text-white",
        "tile": "bg-stone-600 border-stone-800 text-white",
        "tile_muted": "bg-stone-300 border-stone-500",
    },
]


def theme_for_display_order(display_order: int) -> dict[str, str]:
    idx = max(0, min(len(ORDER_THEMES) - 1, int(display_order or 1) - 1))
    return ORDER_THEMES[idx]
