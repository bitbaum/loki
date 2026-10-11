import { loadDevelopmentProfile, type DevelopmentProfile } from "bip-kit";
import { FLEET_MAP_URL, SITE } from "@/lib/site";

/**
 * The roadmap and changelog, read from where they are produced.
 *
 * This repository's ROADMAP.md and CHANGELOG.md are the source; Loki ingests
 * them into the product's profile and publishes it on the fleet map. The site
 * renders the map, so there is no second copy for a page to drift from (fleet
 * AGENTS.md, "The identity contract"). When the map cannot be read — or does
 * not know this product yet — the page says so and links the files on GitHub.
 *
 * Remembered per process, failures included, so a page about the product
 * never stalls the product while the map is down.
 */
const HIT_SECONDS = 300;
const MISS_SECONDS = 60;
const TIMEOUT_MS = 4_000;

let remembered: { until: number; value: Promise<DevelopmentProfile | null> } | null = null;

export function loadDevelopment(): Promise<DevelopmentProfile | null> {
  const now = Date.now();
  if (remembered && remembered.until > now) return remembered.value;
  const fetcher: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: HIT_SECONDS },
    });
  const value = loadDevelopmentProfile(FLEET_MAP_URL, SITE.slug, fetcher).catch(() => null);
  const entry = { until: now + TIMEOUT_MS + 1000, value };
  remembered = entry;
  void value.then((profile) => {
    entry.until = Date.now() + (profile ? HIT_SECONDS : MISS_SECONDS) * 1000;
  });
  return value;
}
