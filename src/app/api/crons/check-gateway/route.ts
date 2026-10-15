// Cron target — is the OpenClaw gateway answering?
//
// WhatsApp and the Telegram chat are both carried by the gateway on this box.
// It died on 2026-10-08 and nothing said so for a week (see lib/gateway-health.ts
// for the whole story). This probes it on the clock and closes the loop:
//   1. DETECT  — one HTTP request to the gateway; any answer means it is up.
//   2. RAISE   — one in-app alert per outage (deduped until it clears) and one
//                Telegram message saying how to restart it. Telegram here goes
//                through the Bot API directly, so it works while the gateway
//                that normally carries the chat is the thing that is down.
//   3. CLEAR   — when it answers again, the alert falls (so the NEXT outage is
//                not swallowed by a flag that never fell) and one recovery
//                message says so.
//
// Schedule: every 10 min (systemd timer, scripts/install-hetzner-crons.sh).
// Scoped to fleet-autopilot users, the same population as check-runner-stall.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { OPENCLAW_GATEWAY_URL } from "@/lib/constants";
import { getFleetAutopilotUserIds } from "@/db/queries/beacon-settings";
import {
  dismissActiveAlertsByType,
  getUserIdsWithActiveAlertType,
  insertActiveAlertOnce,
} from "@/db/queries/alerts";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";
import { gatewayTransition, probeGateway } from "@/lib/gateway-health";
import { COMMS_COPY } from "@/config/comms";

const ALERT_TYPE = "gateway_down";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const probe = await probeGateway(OPENCLAW_GATEWAY_URL);
  const users = await getFleetAutopilotUserIds();
  const flagged = new Set(await getUserIdsWithActiveAlertType(ALERT_TYPE));
  const tg = selfTelegramTarget();
  const c = COMMS_COPY.gateway;
  let raised = 0;
  let cleared = 0;

  // Users with a flag up are considered too, even if they dropped out of the
  // fleet list: a flag that can never fall is a flag that only works once.
  for (const userId of new Set([...users, ...flagged])) {
    const move = gatewayTransition(probe.up, flagged.has(userId));
    if (move === "raise") {
      const created = await insertActiveAlertOnce({
        userId,
        type: ALERT_TYPE,
        severity: "urgent",
        title: c.downTitle,
        description: c.downBody(probe.detail),
        actionUrl: "/system",
        metadata: { detail: probe.detail },
      });
      if (created) {
        raised++;
        if (tg) void sendTelegramMessage(tg, c.downTelegram(probe.detail));
      }
    } else if (move === "clear") {
      const n = await dismissActiveAlertsByType(userId, ALERT_TYPE);
      if (n > 0) {
        cleared++;
        if (tg) void sendTelegramMessage(tg, c.upTelegram);
      }
    }
  }

  // Heartbeat: a healthy tick logs too, so this janitor's silence is
  // distinguishable from "the gateway is fine".
  await logDebug({
    source: "crons/check-gateway",
    level: probe.up ? "info" : "warn",
    message: `gateway ${probe.up ? "up" : "DOWN"} (${probe.detail}); ${users.length} user(s), ${raised} raised, ${cleared} cleared`,
    meta: { up: probe.up, detail: probe.detail, users: users.length, raised, cleared },
  });

  return NextResponse.json({ ok: true, up: probe.up, detail: probe.detail, raised, cleared });
}
