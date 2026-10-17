/**
 * The header's second line: which page this conversation is about.
 *
 * It was `document.title`, and on Loki's own site that title is "Loki" or
 * "Control — Loki", so the header read "LOKI / Loki" — the brand line said
 * twice and the page never named. The brand line already says who you are
 * talking to; this line drops that word and keeps what is left. Pure, so it
 * is tested without a DOM.
 */
const BRAND = "loki";
/** Title separators people actually use: — – | · : and a spaced hyphen. */
const SEPARATOR = /\s+[—–|·:-]\s+|\s*[—–|·]\s*/;

export function pageLabel(title: string, pathname: string): string {
  const parts = title
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== BRAND);
  if (parts.length) return parts.join(" — ");
  const path = pathname.replace(/\/+$/, "");
  return path || "Home";
}
