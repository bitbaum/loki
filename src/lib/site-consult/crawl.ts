import { CONSULT } from "@/config/site-consult";
import { fetchPage, type FetchLike, type LookupLike } from "@/lib/site-consult/fetch-page";
import { attrs, readPage } from "@/lib/site-consult/read-page";

/**
 * The rest of the site, not just its front door.
 *
 * A consultation that reads one page tells an owner about one page — and the
 * page a visitor came for (prices, the menu, "Kontakt") is usually one click
 * further in. So after the homepage, Loki follows the links a visitor would
 * see first (same site only, pages only, never forms or files), reads each the
 * same way through the same SSRF-guarded fetch, and keeps a few facts per
 * page. Bounded on purpose: CONSULT.crawlPages pages, CONSULT.crawlConcurrency
 * at a time, all of it inside CONSULT.crawlBudgetMs — a slow site makes a
 * shorter tour, never a hung request.
 *
 * `internalLinks` is pure (the site-wide verdicts it feeds are in
 * findings.ts); pinned in scripts/test/site-consult.ts.
 */

export type PageTour = {
  /** The path a person reads ("/kontakt"), "/" for the homepage. */
  path: string;
  url: string;
  /** False when the link led to an error or nothing. */
  ok: boolean;
  title: string | null;
  hasDescription: boolean;
  h1Count: number;
  words: number;
  ms: number;
  /** Why it could not be read, in plain words (only when !ok). */
  problem: string | null;
};

/** Files and machinery a visitor never "visits" as a page. */
const NOT_A_PAGE =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|rar|7z|gz|mp3|mp4|m4a|wav|mov|avi|webm|docx?|xlsx?|pptx?|csv|txt|xml|json|js|css|woff2?|ttf|eot|dmg|exe|apk)$/i;
const MACHINERY =
  /\/(wp-admin|wp-login|wp-json|cart|checkout|warenkorb|kasse|basket|order|login|logout|signin|sign-in|signup|sign-up|register|registration|password|account|konto|personal|cabinet|profile|compare|wishlist|favorites?|subscribe|unsubscribe|search|poisk|print|feed|rss|cdn-cgi|xmlrpc)(\/|$)|\/(tag|author|page)\/\d*/i;
/**
 * The small print every site carries and no visitor came for: privacy, terms,
 * imprint, company details. An owner gains nothing from Loki's view of their
 * privacy policy, and a tour that spends its budget there (center-com.ru,
 * 2026-10-17: the login page, the policy, the bank details) reads none of the
 * pages the business lives on.
 */
const SMALL_PRINT =
  /privacy|policy|politika|datenschutz|impressum|imprint|terms|\bagb\b|cookie|rekvizit|legal|disclaimer|sitemap|oferta|soglashenie|widerruf/i;

/** A path as words: "/politika-konfidentsialnosti" → "politika konfidentsialnosti". */
function readable(pathname: string): string {
  let text = pathname;
  try {
    text = decodeURIComponent(pathname);
  } catch {
    /* Malformed escapes stay as typed. */
  }
  return text.replace(/[-_]/g, " ");
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * Where a link sits on the page decides how soon a visitor meets it: the
 * navigation and header first, the body next, the footer last. Regions are
 * found by tag position, so a page without <nav> simply reads in order.
 */
type Region = 0 | 1 | 2;
function regionsOf(html: string): { at: (index: number) => Region } {
  const spans = (name: string): [number, number][] =>
    [...html.matchAll(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}\\s*>`, "gi"))].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
  const first = [...spans("nav"), ...spans("header")];
  const last = spans("footer");
  const inside = (list: [number, number][], i: number) => list.some(([a, b]) => i >= a && i < b);
  return { at: (i) => (inside(first, i) ? 0 : inside(last, i) ? 2 : 1) };
}

/** "/catalog/paint" → "catalog": the section a link opens. */
const sectionOf = (url: URL) => url.pathname.split("/").filter(Boolean)[0] ?? "";

/**
 * The site's own pages linked from this HTML, in the order a visitor meets
 * them — navigation and header first, footer last — deduplicated by path, the
 * page itself, its machinery and its small print excluded. Within the budget
 * the tour spreads across sections (one page of the catalogue, then "about",
 * then "delivery", then the next catalogue page) rather than reading eight
 * catalogue categories and nothing else. Query strings are dropped:
 * `?lang=de` and `?ref=x` are the same page to an owner, and a crawler must
 * not walk calendars.
 */
export function internalLinks(
  html: string,
  pageUrl: string,
  max: number = CONSULT.crawlPages,
): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const baseTag = /<base\b[^>]*>/i.exec(html);
  if (baseTag) {
    const href = attrs(baseTag[0]).href;
    try {
      if (href) base = new URL(href, base);
    } catch {
      /* A broken <base> is ignored, as browsers do. */
    }
  }
  const home = bareHost(new URL(pageUrl).hostname);
  const regions = regionsOf(html);
  const seen = new Set<string>([normalPath(new URL(pageUrl).pathname)]);
  const found: { url: URL; region: Region; order: number }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const raw = (a.href ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|data|sms|whatsapp):/i.test(raw))
      continue;
    if ("download" in a) continue;
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || bareHost(url.hostname) !== home) continue;
    if (url.port || url.username || url.password) continue;
    if (NOT_A_PAGE.test(url.pathname) || MACHINERY.test(url.pathname)) continue;
    if (SMALL_PRINT.test(readable(url.pathname))) continue;
    const key = normalPath(url.pathname);
    if (seen.has(key)) continue;
    seen.add(key);
    url.hash = "";
    url.search = "";
    found.push({ url, region: regions.at(match.index), order: found.length });
  }
  found.sort((a, b) => a.region - b.region || a.order - b.order);
  // Round-robin over sections: the first page of each section, then the second
  // of each, so a shop's tour is not eight categories deep and no "about".
  // The sections with the most links go first: a catalogue of sixty
  // categories IS the business, and a tour of eight header links that never
  // reaches it (center-com.ru, 2026-10-17) has not read the shop.
  const bySection = new Map<string, URL[]>();
  for (const f of found) {
    const list = bySection.get(sectionOf(f.url)) ?? [];
    list.push(f.url);
    bySection.set(sectionOf(f.url), list);
  }
  // Within a section its root ("/catalog/") before its pages; the biggest sections first.
  const depth = (url: URL) => url.pathname.split("/").filter(Boolean).length;
  const sections = [...bySection.values()]
    .map((list) =>
      list
        .map((url, i) => ({ url, i }))
        .sort((a, b) => depth(a.url) - depth(b.url) || a.i - b.i)
        .map((x) => x.url),
    )
    .sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const list of sections) {
      const url = list[round];
      if (!url) continue;
      any = true;
      out.push(url.href);
      if (out.length >= max) break;
    }
    if (!any) break;
  }
  return out;
}

function normalPath(pathname: string): string {
  const p = pathname.replace(/\/index\.(html?|php)$/i, "/").replace(/\/+$/, "");
  return p || "/";
}

/** "/über-uns" rather than "/%C3%BCber-uns" — this is for a person to read. */
export function displayPath(url: string): string {
  try {
    const p = normalPath(new URL(url).pathname);
    try {
      return decodeURI(p);
    } catch {
      return p;
    }
  } catch {
    return url;
  }
}

/** Read the linked pages, a few at a time, inside one overall budget. */
export async function tourSite(
  links: string[],
  deps: { fetchFn?: FetchLike; lookup?: LookupLike; budgetMs?: number } = {},
): Promise<PageTour[]> {
  const deadline = Date.now() + (deps.budgetMs ?? CONSULT.crawlBudgetMs);
  const results: (PageTour | null)[] = links.map(() => null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= links.length || Date.now() >= deadline) return;
      results[i] = await readOne(links[i], deadline, deps);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONSULT.crawlConcurrency, links.length) }, worker),
  );
  return results.filter((r): r is PageTour => r !== null);
}

async function readOne(
  url: string,
  deadline: number,
  deps: { fetchFn?: FetchLike; lookup?: LookupLike },
): Promise<PageTour | null> {
  const left = deadline - Date.now();
  if (left <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const page = await Promise.race([
    fetchPage(url, deps),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), left);
    }),
  ]).finally(() => clearTimeout(timer));
  // Out of time is not the site's fault: the page is simply not in the tour.
  if (!page) return null;
  if (!page.ok)
    return {
      path: displayPath(url),
      url,
      ok: false,
      title: null,
      hasDescription: false,
      h1Count: 0,
      words: 0,
      ms: 0,
      problem: page.reason,
    };
  const facts = readPage(page.html, page.finalUrl, page.headers.robots);
  return {
    path: displayPath(page.finalUrl),
    url: page.finalUrl,
    ok: true,
    title: facts.title,
    hasDescription: Boolean(facts.description),
    h1Count: facts.h1Count,
    words: facts.words,
    ms: page.ms,
    problem: null,
  };
}
