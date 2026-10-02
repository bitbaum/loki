/**
 * Turning what someone SAYS about their website into a brief.
 *
 * /change takes one thing: words, typed or spoken. The address is found in
 * them deterministically — no model call. The page is anonymous, and every
 * keystroke on a stranger's page spending the shared free AI quota is exactly
 * the drain the fleet forbids (memory: no background AI on free tier). A
 * domain is a shape, not a judgement; a regex finds it.
 *
 * Pure, so the rules are pinned without rendering (scripts/test/website-from-speech.ts).
 */

/** Spoken addresses arrive as words: "evig dot ch", "www dot my-site dot com". */
function unspeak(text: string): string {
  return text.replace(/\s+(?:dot|punkt|point)\s+/gi, ".");
}

const DOMAIN =
  /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::\d+)?(\/[^\s,;)]*)?/i;

/** File-like endings that look like domains but are not ("report.pdf"). */
const NOT_A_SITE = /\.(?:pdf|png|jpe?g|gif|svg|webp|docx?|xlsx?|pptx?|zip|txt|md|csv|mp[34]|mov)$/i;

/**
 * The first website address in the text, as `host[/path]`, lowercased host,
 * no scheme, no trailing slash — or null when there is none.
 */
export function extractWebsite(text: string): string | null {
  const match = unspeak(text).match(DOMAIN);
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/^www\./, "www.");
  if (NOT_A_SITE.test(host)) return null;
  const path = (match[2] ?? "").replace(/[.!?]+$/, "").replace(/\/+$/, "");
  return `${host}${path}`;
}

/**
 * Add one thing said to the brief. Each send is its own line, so a person can
 * keep talking ("…and add online booking") without rewriting what came before.
 */
export function appendToBrief(brief: string, said: string, max: number): string {
  const line = said.trim();
  if (!line) return brief;
  const next = brief.trim() ? `${brief.trim()}\n${line}` : line;
  return next.slice(0, max);
}
