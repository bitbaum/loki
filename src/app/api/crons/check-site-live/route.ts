// Cron — a site that went live after registration is recorded, and its owner
// is told once, with the link that readies their widget.
// See src/lib/site-live-reconcile.ts for why registration alone missed it.
//
// Schedule: hourly at :25 (systemd timer, scripts/install-hetzner-crons.sh).
// No AI: GitHub reads and one public fetch per project.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { reconcileSiteLiveUrls } from "@/lib/site-live-reconcile";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const result = await reconcileSiteLiveUrls();
  await logDebug({
    source: "crons/check-site-live",
    level: "info",
    message: `checked ${result.checked}, went live ${result.madeLive}`,
    meta: result,
  });
  return NextResponse.json({ ok: true, ...result });
}
