/**
 * A pasted website address, as a URL — or nothing.
 *
 * "mysite.ch" is what people type; a form that refuses it because it lacks
 * "https://" has failed its one job. A bare word ("localhost", "intranet")
 * is not a site anyone else can open, so it is not one Loki can be put on.
 */
export function normalizeSiteUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.hostname.includes(".") ? u.href : null;
  } catch {
    return null;
  }
}
