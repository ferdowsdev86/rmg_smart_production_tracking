/** Use /assets/... so Vite dev proxy (and nginx) can load HR employee photos. */
export function resolveHrPhotoUrl(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (raw.startsWith("/assets/")) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith("/assets/")) return parsed.pathname;
  } catch {
    /* relative or invalid */
  }
  if (raw.startsWith("assets/")) return `/${raw}`;
  return raw.startsWith("/") ? raw : null;
}
