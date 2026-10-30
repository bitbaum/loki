// Cron target — runner execution-stall detector, recoverer, and alerter.
//
// getRunnerExecutionStall already knows when commands are accepted but never
// executed (the runner's command loop is hung while its push heartbeat still
// says "Connected") — but it only ran when a human loaded /api/control, so a
// stalled fleet stayed silent until someone happened to look. This runs it on
// the clock and closes the loop three ways:
//   1. RECOVER  — reclaim claimed-but-unexecuted commands so a fresh runner
//                 poll re-runs them (idempotent; already safe to call anytime).
//   2. ALERT    — raise one in-app alert per stall (deduped until dismissed)
//                 and ping the operator on Telegram.
//   3. AUDIT    — log every tick to debug_logs as a heartbeat.
//
// Schedule: every 30 min (systemd timer, scripts/install-hetzner-crons.sh).
// Scoped to fleet-autopilot users (the population whose dispatches must land).

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import {
  getRunnerExecutionStall,
  reclaimStalePendingCommands,
} from "@/db/queries/pending-commands";
import { insertActiveAlertOnce } from "@/db/queries/alerts";
import { getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const users = await getFleetAutopilotUserIds();
  let stalledUsers = 0;
  let alertsCreated = 0;
  let reclaimed = 0;

  for (const userId of users) {
    const stall = await getRunnerExecutionStall(userId);
    if (!stall.stalled) continue;
    stalledUsers++;

    // 1. Safe auto-recovery: unstick claimed-but-unexecuted commands. The next
    //    runner poll re-claims and runs them; if the runner itself is dead this
    //    is a no-op until it returns — harmless either way.
    reclaimed += await reclaimStalePendingCommands([userId]);

    // 2. Alert once per stall (deduped until the operator dismisses it).
    const created = await insertActiveAlertOnce({
      userId,
      type: "runner_stall",
      severity: "urgent",
      title:
        stall.stalledCount === 1
          ? "A request is waiting — the runner has not picked it up"
          : `${stall.stalledCount} requests are waiting — the runner has not picked them up`,
      description:
        `Loki already tried again. If it stays like this, open Home and check the runner ` +
        `is online.\n\n` +
        `${stall.stalledCount} dispatched command${stall.stalledCount === 1 ? " has" : "s have"} waited ` +
        `${stall.oldestSeconds}s with no runner executing them; stuck claims were reclaimed ` +
        `for retry. The runner is the cloud runner or Fleet Runner on a computer.`,
      actionUrl: "/control",
      metadata: { stalledCount: stall.stalledCount, oldestSeconds: stall.oldestSeconds },
    });
    if (created) {
      alertsCreated++;
      const tg = selfTelegramTarget();
      if (tg) {
        void sendTelegramMessage(
          tg,
          `⚠️ Loki: runner stalled — ${stall.stalledCount} command(s) waited ${stall.oldestSeconds}s with no runner executing. ` +
            `Reclaimed stuck claims for retry; check the runner.`,
        );
      }
    }
  }

  // 3. Heartbeat + audit — a healthy tick logs too, so the janitor's own
  //    silence is distinguishable from "no stalls".
  await logDebug({
    source: "crons/check-runner-stall",
    level: stalledUsers > 0 ? "warn" : "info",
    message: `Checked ${users.length} user(s): ${stalledUsers} stalled, ${alertsCreated} alerted, ${reclaimed} command(s) reclaimed`,
    meta: { users: users.length, stalledUsers, alertsCreated, reclaimed },
  });

  return NextResponse.json({
    ok: true,
    users: users.length,
    stalledUsers,
    alertsCreated,
    reclaimed,
  });
}
