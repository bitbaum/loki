import { publicProfilePath, type FleetMap } from "@/lib/register/map";
import type { ConciergeLink } from "@/lib/widget-chat/concierge";

/**
 * A project's address that does not answer is not a door. The register says
 * where a product lives; only a request says whether it is there today. Seen
 * 2026-10-18: the map listed addresses nobody had checked, and the chat would
 * have sent a stranger to whatever stood behind them.
 *
 * Only the links a reply actually attaches are asked — never the whole map —
 * because several sites sleep when idle (docs/infrastructure/sleep-when-idle.md)
 * and a sweep from here would keep them awake. Asking just before a visitor is
 * sent is a request they were about to make anyway.
 *
 * A dead address is not hidden: the link falls back to the project's public
 * profile, which Loki serves and which says what the project is.
 */

/** Down = no connection, or an answer that means "nothing here". A timeout is unknown, not down. */
export function answers(status: number): boolean {
  return status < 500 && status !== 404 && status !== 410;
}

export type Prober = (url: string) => Promise<boolean>;

const PROBE_TIMEOUT_MS = 6000;
const PROBE_TTL_MS = 10 * 60 * 1000;
const probed = new Map<string, { up: boolean; at: number }>();

/** One request per address per ten minutes, however many visitors ask. */
export const probeAddress: Prober = async (url) => {
  const hit = probed.get(url);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.up;
  let up: boolean;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "loki-concierge-link-check" },
    });
    await res.body?.cancel();
    up = answers(res.status);
  } catch (e) {
    // A slow wake is not a dead site: only a refused or unresolvable address is.
    up = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
  }
  probed.set(url, { up, at: Date.now() });
  return up;
};

/** Swap every project link whose running address does not answer for its public profile. */
export async function reachableLinks(
  links: ConciergeLink[],
  map: FleetMap,
  appBase: string,
  isUp: Prober = probeAddress,
): Promise<ConciergeLink[]> {
  const bySite = new Map(
    map.projects.filter((p) => p.urls.live).map((p) => [p.urls.live as string, p.slug]),
  );
  return Promise.all(
    links.map(async (link) => {
      const slug = bySite.get(link.url);
      if (!slug || (await isUp(link.url))) return link;
      return { ...link, url: `${appBase}${publicProfilePath(slug)}` };
    }),
  );
}
