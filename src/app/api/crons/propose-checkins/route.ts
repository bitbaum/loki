// Cron target — proactively propose "check in with X" reminders for contacts
// whose relationship has gone cold.
//
// The reactive producer (extract-proposal) queues an action when the operator
// asks Loki to do something. This is the proactive counterpart: when a
// relationship fades and nobody said anything, the life-OS notices and proposes
// a nudge. Everything it queues is a status='draft' CREATE_COMMITMENT the
// operator still approves before it does anything (IRON RULE).
//
// Scope mirrors the autopilot night: only fires for users with fleet autopilot ON (the
// same "I trust the system to keep moving for me" opt-in). Bounded per user by a
// queue-pressure cap, a 30-day per-contact cooldown, and a small per-tick limit
// (see checkin-producer.ts) so it can never flood the approval queue.
//
// Schedule: daily (systemd timer, scripts/install-hetzner-crons.sh). Idempotent:
// the cooldown + draft dedupe make a second run a no-op.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import { proposeCheckins } from "@/lib/actions/checkin-producer";
import { logDebug } from "@/db/queries/debug-logs";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const nowMs = Date.now();
  const users = await getFleetAutopilotUserIds();

  let proposedTotal = 0;
  const perUser: Array<{
    userId: string;
    proposed: number;
    scanned: number;
    skipped: string | null;
  }> = [];

  for (const userId of users) {
    try {
      const r = await proposeCheckins(userId, nowMs);
      proposedTotal += r.proposed.length;
      perUser.push({ userId, proposed: r.proposed.length, scanned: r.scanned, skipped: r.skipped });
    } catch (e) {
      perUser.push({ userId, proposed: 0, scanned: 0, skipped: `error:${(e as Error).message}` });
    }
  }

  await logDebug({
    source: "crons/propose-checkins",
    level: "info",
    message: `Proposed ${proposedTotal} check-in(s) across ${users.length} autopilot-on user(s)`,
    meta: { proposedTotal, perUser },
  }).catch(() => {});

  return NextResponse.json({ ok: true, users: users.length, proposed: proposedTotal, perUser });
}
