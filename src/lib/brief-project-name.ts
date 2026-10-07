import { normalizeProjectName } from "@/lib/project-name";

/**
 * Names for projects started from a brief (/change, /take).
 *
 * A project's name becomes its GitHub repository and its preview address
 * (<name>.orangecat.ch). They used to be `<host>-refresh-<32 hex request id>`
 * — xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf.orangecat.ch — because
 * the name doubled as the duplicate-submit guard. The operator, on that very
 * preview: "why not just xhiva.orangecat.ch". The guard now lives in the
 * project's metadata (lib/kickoff/start-brief-project), so the name can be
 * the site's own name, with -2, -3 only when it is genuinely taken.
 */

/** Second-level labels that are part of a public suffix ("co.uk", "com.au"). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne", "gv"]);

/** The registrable name of a site: "www.xhiva.art" → "xhiva", "my-bakery.co.uk" → "my-bakery". */
export function siteName(website: string): string {
  // Accents off first: the URL parser would turn "café-zürich.ch" into
  // punycode ("xn--caf-zrich-…"), a name nobody would recognise as theirs.
  const ascii = website.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let host: string;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:/i.test(ascii) ? ascii : `https://${ascii}`).hostname;
  } catch {
    host = ascii;
  }
  const labels = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length > 1) labels.pop(); // the TLD
  if (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  return normalizeProjectName(labels[labels.length - 1] ?? host) || "site";
}

/** The first free name among base, base-2, base-3, … (taken = repo or preview already used). */
export async function firstFreeName(
  base: string,
  isTaken: (name: string) => Promise<boolean>,
  limit = 50,
): Promise<string> {
  const root = normalizeProjectName(base) || "project";
  for (let n = 1; n <= limit; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Fifty sites of one name is not a naming problem; fall back to a short stamp.
  return `${root}-${Date.now().toString(36)}`;
}
