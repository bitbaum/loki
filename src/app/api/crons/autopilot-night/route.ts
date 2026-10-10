// Cron — the autopilot night. Replaces `nudge-idle` (2026-10-10): the night
// works from the feedback inbox under the account's run budget, reads one
// site when there is room, files away what nobody started, and leaves one
// line for the morning. The plan is src/config/autopilot-night.ts; the work
// is src/lib/autopilot-night.ts.
//
// Schedule: daily at 02:30 UTC (systemd timer, scripts/install-hetzner-crons.sh),
// so a fix merges and deploys before the owner wakes. The box keeps the old
// `fc-cron@nudge-idle.timer` until the installer is run once more.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { nightRunsStarted } from "@/config/autopilot-night";
import { runAutopilotNight } from "@/lib/autopilot-night";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  try {
    const tick = await runAutopilotNight();
    const started = tick.summaries.reduce((n, s) => n + nightRunsStarted(s.summary), 0);
    await logDebug({
      source: "crons/autopilot-night",
      level: "info",
      message: `Night ${tick.night}: ${tick.summaries.length} of ${tick.users} accounts ran, ${started} runs started`,
      meta: {
        night: tick.night,
        accounts: tick.summaries.map((s) => ({
          userId: s.userId,
          fixes: s.summary.fixes,
          reads: s.summary.reads,
          archived: s.summary.archived,
          rerouted: s.summary.rerouted,
          skipped: s.summary.skipped,
        })),
      },
    });
    return NextResponse.json({ ok: true, ...tick });
  } catch (e) {
    const msg = (e as Error).message;
    await logDebug({
      source: "crons/autopilot-night",
      level: "error",
      message: `Night failed: ${msg}`,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
