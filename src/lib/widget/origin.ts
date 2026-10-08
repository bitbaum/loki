/**
 * Which page origins may use a widget token — the one rule every widget route
 * applies (boot, ingest, chat, advise, transcribe).
 *
 * A token's `origins` list is written when the widget is installed. A site's
 * addresses, though, live in apps.conf (the hosting SSOT), and can grow
 * afterwards: a short preview host added beside the long one, a customer
 * domain attached by hand. Before this, any address added outside Loki's own
 * attach flow was missing from the token, so the widget silently refused to
 * render there while working on the site's other address — the
 * "why is the widget on one URL and not the other?" report (xhiva, 2026-10-08:
 * xhiva.orangecat.ch was in apps.conf, not in the token).
 *
 * So an origin is allowed when the token lists it, OR when it is another
 * address of a hosted site the token already lists. The token names the site;
 * apps.conf says where that site lives. No address is ever allowed that is not
 * the token's own site.
 */
import { readAppsConf, type HostedApp } from "@/lib/register/apps-conf";
import { studioRepoRoot } from "@/lib/site-cd-local";

/** apps.conf ships with the build and changes with deploys; re-read it at most this often. */
const APPS_TTL_MS = 5 * 60 * 1000;
let cachedApps: { apps: HostedApp[]; at: number } | null = null;

function hostedApps(): HostedApp[] {
  if (cachedApps && Date.now() - cachedApps.at < APPS_TTL_MS) return cachedApps.apps;
  // The box's working register first: a domain added there lands before main deploys.
  const apps = [...readAppsConf(studioRepoRoot()), ...readAppsConf()];
  cachedApps = { apps, at: Date.now() };
  return apps;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * The token's origins plus every other address of the hosted site(s) they
 * belong to, as `https://<domain>` origins. Pure, for tests: pass the apps.
 */
export function expandWidgetOrigins(
  tokenOrigins: readonly string[],
  apps: readonly HostedApp[],
): Set<string> {
  const allowed = new Set(tokenOrigins);
  const hosts = new Set(tokenOrigins.map(hostOf).filter((h): h is string => h !== null));
  for (const app of apps) {
    if (!app.domains.some((domain) => hosts.has(domain))) continue;
    for (const domain of app.domains) allowed.add(`https://${domain}`);
  }
  return allowed;
}

export type OriginCheck = {
  /** The token's allowlist; empty or null means "any origin". */
  tokenOrigins: readonly string[] | null | undefined;
  /** The request's Origin header. */
  origin: string | null;
  /**
   * Whether a request without an Origin header passes. Boot allows it (same-
   * origin dogfood, curl health checks); the routes that accept input do not.
   */
  allowMissingOrigin: boolean;
};

/** Is this request's origin allowed to use the token? */
export function isWidgetOriginAllowed(
  { tokenOrigins, origin, allowMissingOrigin }: OriginCheck,
  apps: readonly HostedApp[] = hostedApps(),
): boolean {
  if (!tokenOrigins?.length) return true;
  if (!origin) return allowMissingOrigin;
  if (tokenOrigins.includes(origin)) return true;
  return expandWidgetOrigins(tokenOrigins, apps).has(origin);
}
