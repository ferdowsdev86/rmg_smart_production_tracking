/** All dashboard thresholds / constants in one place. */
export const DASH = {
  SHIFT_START_HOUR: 8,
  SHIFT_END_HOUR: 21,
  // RAG for achievement vs time-elapsed-expected output
  ACH_GREEN: 95, // ≥95% of expected-by-now → green
  ACH_AMBER: 80, // 80–95 amber, below → red
  DHU_LIMIT: 3, // % green limit
  DHU_AMBER: 5, // 3–5 amber, >5 red
  RFT_TARGET: 95,
  // machine cell color bands (% of that machine's hourly target)
  CELL_GREEN: 100,
  CELL_LIGHT: 80,
  CELL_AMBER: 50,
  // alerts
  SLOW_PCT: 50, // below 50% of machine hour target
  SLOW_HOURS: 2, // for 2 consecutive completed hours
  NPT_RUNNING_ALERT_MIN: 15,
  STALE_SECONDS: 60,
  TV_ROTATE_SECONDS: 30,
  REFRESH_MS: 8000,
};

export const RAG_COLORS = {
  green: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-500", dot: "#059669", soft: "#ecfdf5" },
  amber: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-500", dot: "#d97706", soft: "#fffbeb" },
  red: { text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-500", dot: "#e11d48", soft: "#fff1f2" },
  grey: { text: "text-slate-500", bg: "bg-slate-50", border: "border-slate-300", dot: "#94a3b8", soft: "#f8fafc" },
};

export const BRAND_BLUE = "#2a66c4";
