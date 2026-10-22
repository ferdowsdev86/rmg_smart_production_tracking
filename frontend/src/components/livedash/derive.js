import { DASH } from "./config";

/* ----------------------------------------------------------------------
   Pure derivations over the existing /automation/floor_overview/ payload.
   No backend contract changes — everything here is computed client-side.
   ---------------------------------------------------------------------- */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function ragForAchievement(pctOfExpected) {
  if (pctOfExpected >= DASH.ACH_GREEN) return "green";
  if (pctOfExpected >= DASH.ACH_AMBER) return "amber";
  return "red";
}

export function ragForDhu(dhu) {
  if (dhu <= DASH.DHU_LIMIT) return "green";
  if (dhu <= DASH.DHU_AMBER) return "amber";
  return "red";
}

export function hhmm(min) {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** hour-of-day for "now" (browser clock = factory clock on site). */
function nowParts(now) {
  return { h: now.getHours(), m: now.getMinutes() };
}

export function deriveShift(D, now, isToday) {
  const hrs = D.hourly || [];
  const startH = hrs.length ? hrs[0].hour : DASH.SHIFT_START_HOUR;
  const planned = hrs.filter((s) => !s.overtime);
  const endH = planned.length ? ((planned[planned.length - 1].hour + 1) % 24) : DASH.SHIFT_END_HOUR;
  const totalHrs = planned.length || DASH.SHIFT_END_HOUR - DASH.SHIFT_START_HOUR;
  const { h, m } = nowParts(now);
  let elapsed = isToday ? h + m / 60 - startH : totalHrs;
  elapsed = Math.max(0, Math.min(elapsed, totalHrs));
  return {
    startH,
    endH,
    totalHrs,
    elapsedHrs: elapsed,
    pctElapsed: totalHrs ? (elapsed / totalHrs) * 100 : 0,
    nowH: h,
    isToday,
  };
}

export function deriveRates(D, shift) {
  const T = D.totals || {};
  const hrs = D.hourly || [];
  const target = num(T.target);
  const output = num(T.output);
  const hourTarget = hrs.length ? num(hrs[0].target) : 0;
  const completedHours = Math.max(0, Math.floor(shift.elapsedHrs));
  const completedOutput = hrs
    .filter((s) => s.hour >= shift.startH && s.hour < shift.startH + completedHours)
    .reduce((a, s) => a + num(s.actual), 0);
  const currentAvgRate = completedHours > 0 ? completedOutput / completedHours : 0;
  const remainingHours = Math.max(0, shift.totalHrs - shift.elapsedHrs);
  const projectedEOD = Math.round(output + currentAvgRate * remainingHours);
  const requiredRate = remainingHours > 0 ? (target - output) / remainingHours : 0;
  const expectedByNow = shift.totalHrs ? target * (shift.elapsedHrs / shift.totalHrs) : 0;
  const pctOfExpected = expectedByNow > 0 ? (output / expectedByNow) * 100 : 100;
  return {
    target,
    output,
    hourTarget,
    completedHours,
    completedOutput,
    currentAvgRate,
    remainingHours,
    projectedEOD,
    projectedPct: target ? Math.round((projectedEOD / target) * 100) : 0,
    requiredRate: Math.max(0, Math.round(requiredRate)),
    expectedByNow: Math.round(expectedByNow),
    pctOfExpected,
  };
}

export function deriveHealth(D, shift, rates, now) {
  const T = D.totals || {};
  const dhu = num(T.dhu_pct);
  const achRag = shift.isToday && shift.elapsedHrs > 0.5 ? ragForAchievement(rates.pctOfExpected) : "grey";
  const dhuRag = T.checked > 0 ? ragForDhu(dhu) : "grey";
  const order = { red: 3, amber: 2, grey: 0, green: 1 };
  const overall = [achRag, dhuRag].sort((a, b) => order[b] - order[a])[0];
  const label = overall === "red" ? "Critical" : overall === "amber" ? "At Risk" : overall === "grey" ? "Standby" : "On Track";
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const parts = [];
  parts.push(`${rates.output.toLocaleString()} / ${rates.target.toLocaleString()} pcs (${num(T.ach_pct).toFixed(1)}%) at ${hm}.`);
  if (shift.isToday && rates.remainingHours > 0 && rates.target) {
    parts.push(`Projected end of day ≈ ${rates.projectedEOD.toLocaleString()} (${rates.projectedPct}%).`);
    parts.push(`Need ${rates.requiredRate} pcs/hr from now (hour target ${rates.hourTarget}).`);
  }
  if (T.checked > 0) parts.push(`DHU ${dhu.toFixed(2)}% vs ${DASH.DHU_LIMIT}% limit.`);
  return { overall, label, achRag, dhuRag, sentence: `${label} — ${parts.join(" ")}` };
}

/* ---------------- machines -------------------------------------------- */

function nptStartHour(row) {
  const t = String(row.start_at || "");
  const m = t.match(/^(\d{1,2}):/);
  return m ? parseInt(m[1], 10) : null;
}

export function deriveMachines(D, shift, rates, operators) {
  const hrs = D.hourly || [];
  const hourList = hrs.map((s) => s.hour);
  const qual = new Map((D.machines || []).map((m) => [num(m.machin_id), m]));
  const nptByMachine = new Map((D.npt?.machines || []).map((r) => [num(r.machin_id), num(r.minutes)]));
  const openNpt = new Map();
  const nptHourBadges = new Map(); // mid -> {hour: minutes}
  for (const r of D.npt?.rows || []) {
    const mid = num(r.machin_id);
    if (r.is_open) openNpt.set(mid, r);
    const h = nptStartHour(r);
    if (h != null) {
      const bag = nptHourBadges.get(mid) || {};
      bag[h] = (bag[h] || 0) + num(r.minutes);
      nptHourBadges.set(mid, bag);
    }
  }

  const rows = (D.machine_hours || []).map((m) => {
    const mid = num(m.machin_id);
    const byHour = m.by_hour || {};
    const total = num(m.total);
    return { mid, byHour, total };
  });
  const runningCount = Math.max(1, rows.filter((r) => r.total > 0).length);
  // Machine output is operation-level pcs, far above the finished-garment
  // hour target — so the per-machine benchmark is the LINE AVERAGE machine
  // rate (total operation pcs / running machines / completed hours). A
  // machine at the line average shows ≈100% efficiency.
  const doneHrs = Math.max(1, rates.completedHours || 1);
  const totalAllPcs = rows.reduce((a, r) => a + r.total, 0);
  const machineHourTarget = totalAllPcs > 0 ? totalAllPcs / runningCount / doneHrs : 0;

  const nowH = shift.nowH;
  const lastDoneH = shift.isToday ? nowH - 1 : hourList[hourList.length - 1];

  const out = rows.map((r) => {
    const op = operators?.[r.mid] || {};
    const q = qual.get(r.mid) || {};
    const completedVals = hourList
      .filter((h) => (shift.isToday ? h < nowH : true) && h >= shift.startH)
      .map((h) => num(r.byHour[String(h)]));
    const doneHours = Math.max(1, completedVals.length);
    const avg = r.total / doneHours;
    const eff = machineHourTarget > 0 ? (avg / machineHourTarget) * 100 : 0;
    const lastHourOut = num(r.byHour[String(lastDoneH)]);
    const currentOut = num(r.byHour[String(nowH)]);
    const nptMin = nptByMachine.get(r.mid) || 0;
    const open = openNpt.get(r.mid) || null;
    const started = r.total > 0;

    let status = "running";
    if (open) status = "down";
    else if (!started) status = "notstarted";
    else if (shift.isToday && lastHourOut === 0 && currentOut === 0) status = "idle";
    else if (machineHourTarget > 0 && eff < DASH.SLOW_PCT) status = "slow";

    // ACTION text
    let action = "On target ✓";
    if (open) action = `Down ${hhmm(minutesSince(open.start_at))} (${open.category}) → maintenance`;
    else if (!started) action = "No output today → check machine";
    else if (status === "idle") action = "No output this hour → supervisor";
    else if (status === "slow") action = `Running at ${Math.round(eff)}% → supervisor visit`;
    else if (lastHourOut > 0 && avg > 0 && lastHourOut < avg * 0.4)
      action = `Dropped ${Math.round((1 - lastHourOut / avg) * 100)}% last hour → supervisor`;
    if (num(q.defect) >= 2) action = `${action !== "On target ✓" ? action + " · " : ""}High defects (${q.defect}) → QC check`;
    const firstHour = hourList.find((h) => num(r.byHour[String(h)]) > 0);
    if (action === "On target ✓" && firstHour != null && firstHour > shift.startH)
      action = `Started late (${String(firstHour).padStart(2, "0")}:00)`;

    const spark = hourList
      .filter((h) => h <= lastDoneH)
      .slice(-5)
      .map((h) => num(r.byHour[String(h)]));

    return {
      mid: r.mid,
      operator: op.operator_name || "",
      operation: op.machin_name || "",
      byHour: r.byHour,
      total: r.total,
      avg,
      eff,
      lastHourOut,
      currentOut,
      status,
      action,
      defect: num(q.defect),
      reject: num(q.reject),
      dhu_pct: num(q.dhu_pct),
      scanned: num(q.scanned),
      nptMin,
      nptOpen: open,
      nptHourBadges: nptHourBadges.get(r.mid) || {},
      spark,
      trend: spark.length >= 2 ? Math.sign(spark[spark.length - 1] - avg) : 0,
      machineHourTarget,
    };
  });

  // bottleneck per hour = lowest non-zero among started machines
  const bottleneck = {};
  for (const h of hourList) {
    let worst = null;
    for (const m of out) {
      if (m.total === 0) continue;
      const v = num(m.byHour[String(h)]);
      if (worst == null || v < worst.v) worst = { mid: m.mid, v };
    }
    if (worst) bottleneck[h] = worst.mid;
  }
  return { machines: out, machineHourTarget, bottleneck, runningCount };
}

export function minutesSince(hhmmss) {
  const m = String(hhmmss || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes() - (parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  return Math.max(0, mins);
}

/* ---------------- alerts ---------------------------------------------- */

export function deriveAlerts(D, shift, rates, mach, health) {
  const alerts = [];
  const startLabel = `${String(shift.startH).padStart(2, "0")}:00`;
  for (const m of mach.machines) {
    if (m.status === "notstarted" && shift.isToday && shift.elapsedHrs > 1)
      alerts.push({ id: `ns-${m.mid}`, sev: "red", text: `M${m.mid} — 0 pcs all day`, owner: "Maintenance / Line chief", since: `since ${startLabel}` });
    else if (m.status === "idle")
      alerts.push({ id: `idle-${m.mid}`, sev: "amber", text: `M${m.mid} no output in current hour`, owner: "Supervisor", since: "" });
    if (m.nptOpen) {
      const mins = minutesSince(m.nptOpen.start_at);
      if (mins >= DASH.NPT_RUNNING_ALERT_MIN)
        alerts.push({ id: `npt-${m.mid}`, sev: "red", text: `M${m.mid} down ${hhmm(mins)} (${m.nptOpen.category})`, owner: "Maintenance", since: `since ${m.nptOpen.start_at?.slice(0, 5)}` });
    }
    // below 50% for 2 consecutive completed hours
    if (shift.isToday && m.total > 0 && mach.machineHourTarget > 0) {
      const h1 = num(m.byHour[String(shift.nowH - 1)]);
      const h2 = num(m.byHour[String(shift.nowH - 2)]);
      const lim = mach.machineHourTarget * (DASH.SLOW_PCT / 100);
      if (shift.nowH - 2 >= shift.startH && h1 < lim && h2 < lim && (h1 > 0 || h2 > 0))
        alerts.push({ id: `slow-${m.mid}`, sev: "amber", text: `M${m.mid} below ${DASH.SLOW_PCT}% of hourly target for 2 hrs`, owner: "Supervisor", since: "" });
    }
  }
  const T = D.totals || {};
  if (num(T.checked) > 0 && num(T.dhu_pct) > DASH.DHU_LIMIT) {
    const worst = [...mach.machines].sort((a, b) => b.defect - a.defect)[0];
    alerts.push({
      id: "dhu",
      sev: num(T.dhu_pct) > DASH.DHU_AMBER ? "red" : "amber",
      text: `DHU ${num(T.dhu_pct).toFixed(2)}% (>${DASH.DHU_LIMIT}%)${worst && worst.defect ? ` — top defect station M${worst.mid}` : ""}`,
      owner: "QC",
      since: "",
    });
  }
  if (health.achRag === "red" && shift.isToday)
    alerts.push({ id: "ach", sev: "red", text: `Achievement ${rates.pctOfExpected.toFixed(0)}% of expected-by-now — need ${rates.requiredRate} pcs/hr`, owner: "Line chief", since: "" });
  else if (health.achRag === "amber" && shift.isToday)
    alerts.push({ id: "ach", sev: "amber", text: `Achievement ${rates.pctOfExpected.toFixed(0)}% of expected-by-now`, owner: "Line chief", since: "" });
  const sevOrder = { red: 0, amber: 1 };
  alerts.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev]);
  return alerts;
}

/* ---------------- insights -------------------------------------------- */

export function deriveInsights(D, shift, rates, mach) {
  const out = [];
  const hrs = (D.hourly || []).filter((s) => (shift.isToday ? s.hour < shift.nowH : true));
  if (hrs.length) {
    const gap = hrs.map((s) => ({ h: s.label, g: num(s.target) - num(s.actual) })).sort((a, b) => b.g - a.g)[0];
    if (gap && gap.g > 0) out.push(`Biggest gap hour: ${gap.h} — ${gap.g} pcs behind target.`);
  }
  const worstQ = [...mach.machines].filter((m) => m.defect > 0).sort((a, b) => b.dhu_pct - a.dhu_pct)[0];
  if (worstQ) out.push(`Worst DHU station: M${worstQ.mid} — ${worstQ.dhu_pct}% (${worstQ.defect} defects).`);
  const idle = mach.machines.filter((m) => m.status === "notstarted" || m.status === "idle");
  if (idle.length) out.push(`${idle.length} machine(s) idle / not started: ${idle.slice(0, 5).map((m) => `M${m.mid}`).join(", ")}${idle.length > 5 ? "…" : ""}.`);
  const cat = (D.npt?.categories || [])[0];
  if (cat && cat.minutes > 0) out.push(`NPT driver: ${cat.category} — ${hhmm(cat.minutes)} across ${cat.events ?? "?"} event(s).`);
  if (shift.isToday && rates.target) out.push(`Projection: ≈ ${rates.projectedEOD.toLocaleString()} pcs by end of shift (${rates.projectedPct}% of target) at the current ${Math.round(rates.currentAvgRate)} pcs/hr.`);
  return out.slice(0, 5);
}
