/** Format seconds as `0h 0m 0s`. */
export function formatDurationHms(seconds, fallback = "0h 0m 0s") {
  if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return fallback;
  const total = Math.floor(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${m}m ${s}s`;
}

/** flag1 sum (seconds): under 60s as sec, else min; 60+ min as hr. */
export function formatSmartDuration(seconds, fallback = "0 sec") {
  const total = Math.floor(Number(seconds));
  if (seconds == null || Number.isNaN(seconds) || total <= 0) return fallback;
  if (total < 60) return `${total} sec`;
  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return secs ? `${minutes} min ${secs} sec` : `${minutes} min`;
  }
  const hours = Math.floor(total / 3600);
  const rem = total % 3600;
  const minutes = Math.floor(rem / 60);
  const secs = rem % 60;
  const parts = [`${hours} hr`];
  if (minutes) parts.push(`${minutes} min`);
  if (secs) parts.push(`${secs} sec`);
  return parts.join(" ");
}
