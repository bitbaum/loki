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

/** Words that only frame an address: "my site is …", "hier ist meine Seite …". */
const FRAMING = new Set(
  (
    "my our the a this here here's heres it it's its is at of for me please check look see url address link " +
    "site website webpage page homepage home " +
    "meine mein unsere unser die das der hier ist bitte seite webseite homepage schau " +
    "mon ma notre le la voici est c s regarde"
  ).split(" "),
);

/**
 * Whether what was said carries anything beyond the address. "my-bakery.ch"
 * or "my site is my-bakery.ch" is the address alone — the consultation's
 * question, not a change request — so it must not land in the brief as one.
 */
export function saysMoreThanAddress(text: string): boolean {
  return unspeak(text)
    .replace(new RegExp(DOMAIN.source, "gi"), " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word && !FRAMING.has(word));
}
