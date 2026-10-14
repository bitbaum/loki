// Cron — every person's projects get their package-update setting applied to
// the Dependabot pull requests open in them.
//
// Why a timer: the fleet sweep merges a green, unheld, non-breaking Dependabot
// pull request minutes after its checks pass. "Ask me" and "Stay on these
// versions" only mean something if Loki puts its hold on before that, so it
// cannot wait for someone to open a page. See src/lib/packages/updates.ts.
//
// Schedule: every 15 minutes (UPDATE_SYNC_SCHEDULE in
// src/config/package-updates.ts, timer in scripts/install-hetzner-crons.sh).
// No AI: GitHub reads (a conditional listing per project, mostly 304s) and the
// label writes a setting calls for.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { getAllDistinctUserIds } from "@/db/queries/user-projects";
import { syncUserPackages } from "@/lib/packages/sync";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const summary = { people: 0, projects: 0, open: 0, held: 0, failed: 0 };
  for (const userId of await getAllDistinctUserIds()) {
    // One person's GitHub trouble is theirs; the next person's projects still run.
    const result = await syncUserPackages(userId, { updatesOnly: true }).catch(() => null);
    if (!result) {
      summary.failed++;
      continue;
    }
    summary.people++;
    for (const r of result.results) {
      if (!r.updates) continue;
      summary.projects++;
      summary.open += r.updates.open;
      summary.held += r.updates.held;
      if (r.updates.error) summary.failed++;
    }
  }
  await logDebug({
    source: "crons/sync-package-updates",
    level: summary.failed > 0 ? "warn" : "info",
    message: `${summary.open} open update(s) across ${summary.projects} project(s), ${summary.held} held`,
    meta: summary,
  });
  return NextResponse.json({ ok: true, ...summary });
}
