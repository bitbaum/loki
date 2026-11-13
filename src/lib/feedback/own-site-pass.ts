import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { createOwnerPass } from "@/lib/feedback/owner-pass";
import { canActForSite } from "@/lib/feedback/pass-holder";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";

/**
 * The owner's pass for Loki's OWN widget, minted for the signed-in person.
 *
 * Inside Loki the header's spiral opened the visitor's panel: "I own or build
 * this site — sign in with Loki →", "No account? You make one on the way",
 * "Made with Loki →", "Hide this button on this site" — shown to the owner,
 * signed in, on his own app (audit, 2026-11-12). The widget only knows the
 * owner by a pass, and on every other site a pass arrives through
 * /api/widget/owner's round trip. Here the session already says who it is, so
 * the app layout mints the same pass with the same check (canActForSite) and
 * the page hands it to the widget. Anyone else gets null and the panel they
 * got before.
 */
const TTL_MS = 10 * 60_000;
let cached: {
  token: string;
  at: number;
  site: { userId: string; projectId: string } | null;
} | null = null;

async function dogfoodSite(token: string) {
  if (cached && cached.token === token && Date.now() - cached.at < TTL_MS) return cached.site;
  const row = await getWidgetTokenByToken(token);
  const site =
    row && row.status === WIDGET_TOKEN_STATUS.ACTIVE
      ? { userId: row.userId, projectId: row.projectId }
      : null;
  cached = { token, at: Date.now(), site };
  return site;
}

export async function ownSitePass(token: string, userId: string): Promise<string | null> {
  if (!token.startsWith("fcw_")) return null;
  const site = await dogfoodSite(token);
  if (!site || !canActForSite(userId, site)) return null;
  return createOwnerPass(site.projectId, userId);
}
