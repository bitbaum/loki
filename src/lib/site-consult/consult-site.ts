import { CONSULT } from "@/config/site-consult";
import { fetchPage } from "@/lib/site-consult/fetch-page";
import { consult, type Consultation } from "@/lib/site-consult/findings";
import { readPage } from "@/lib/site-consult/read-page";

/**
 * Fetch, read, judge — and remember for CONSULT.cacheMs, so a visitor who
 * signs in mid-way, or reloads, sees the same report without Loki reading
 * their site again. Only reports are kept: a failure may be a passing blip,
 * and the next try should really try. Bounded: the oldest entry goes first.
 */
type Outcome = { ok: true; consultation: Consultation } | { ok: false; reason: string };

const cache = new Map<string, { at: number; outcome: Outcome }>();

export async function consultSite(website: string): Promise<Outcome> {
  const key = website.trim().toLowerCase().replace(/\/+$/, "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CONSULT.cacheMs) return hit.outcome;

  const page = await fetchPage(website);
  const outcome: Outcome = page.ok
    ? {
        ok: true,
        consultation: consult({
          finalUrl: page.finalUrl,
          ms: page.ms,
          bytes: page.bytes,
          facts: readPage(page.html, page.finalUrl, page.headers.robots),
        }),
      }
    : { ok: false, reason: page.reason };

  if (!outcome.ok) return outcome;
  cache.delete(key);
  cache.set(key, { at: Date.now(), outcome });
  while (cache.size > CONSULT.cacheEntries) cache.delete(cache.keys().next().value!);
  return outcome;
}
