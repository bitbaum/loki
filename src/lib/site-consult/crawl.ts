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
 * `internalLinks` and `siteVerdicts` are pure; pinned in
 * scripts/test/site-consult.ts.
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
  /\/(wp-admin|wp-login|wp-json|cart|checkout|warenkorb|kasse|login|logout|signin|sign-in|account|konto|feed|cdn-cgi|xmlrpc)(\/|$)|\/(tag|author|page)\/\d*/i;

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * The site's own pages linked from this HTML, in the order a visitor meets
 * them (navigation first, as the page is written), deduplicated by path, the
 * page itself excluded. Query strings are dropped: `?lang=de` and `?ref=x`
 * are the same page to an owner, and a crawler must not walk calendars.
 */
export function internalLinks(html: string, pageUrl: string, max = CONSULT.crawlPages): string[] {
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
  const seen = new Set<string>([normalPath(new URL(pageUrl).pathname)]);
  const out: string[] = [];
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
    const key = normalPath(url.pathname);
    if (seen.has(key)) continue;
    seen.add(key);
    url.hash = "";
    url.search = "";
    out.push(url.href);
    if (out.length >= max) break;
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
  const page = await Promise.race([
    fetchPage(url, deps),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), left)),
  ]);
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
