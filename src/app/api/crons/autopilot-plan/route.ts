// Cron — the evening before the autopilot night (2026-10-10). Makes tonight's
// plan with names and a price on it and puts it in front of each owner as one
// approval-queue row: Approve / Reject on Control, Telegram and /approvals.
// Under an allowance the owner set in advance the row is approved for them and
// they are told. The night (`crons/autopilot-night`) then runs only what was
// approved. The plan is src/config/autopilot-night.ts; the work is
// src/lib/autopilot-night.ts.
//
// Schedule: daily at 19:00 UTC (systemd timer, scripts/install-hetzner-crons.sh)
// — early evening in Europe, so a yes is one tap before bed, not a 02:30 alarm.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { proposeAutopilotNight } from "@/lib/autopilot-night";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  try {
    const tick = await proposeAutopilotNight();
    const asked = tick.outcomes.filter((o) => o.outcome === "asked").length;
    const allowed = tick.outcomes.filter((o) => o.outcome === "allowance").length;
    await logDebug({
      source: "crons/autopilot-plan",
      level: "info",
      message: `Evening ${tick.night}: ${tick.users} accounts, ${asked} asked, ${allowed} under an allowance`,
      meta: { night: tick.night, outcomes: tick.outcomes },
    });
    return NextResponse.json({ ok: true, ...tick });
  } catch (e) {
    const msg = (e as Error).message;
    await logDebug({
      source: "crons/autopilot-plan",
      level: "error",
      message: `Evening plan failed: ${msg}`,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
