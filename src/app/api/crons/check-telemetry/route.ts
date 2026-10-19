// Cron target — telemetry freshness detector.
//
// `claude_code_history` stopped receiving rows on 2026-06-10 and was still
// stopped 76 days later. Every check in the system passed the whole time: Fleet
// Doctor asserted the table EXISTS, the ingest swallowed its own errors by
// design (it must never block the operator), and /activity rendered fine — just
// missing 76 days of local agent work. Nothing was looking at whether the
// sensor still produced anything, so the outage had no symptom.
//
// This is the clock asking the one question that can tell: is there a RECENT ROW?
//
// Deliberately ZERO tokens and one cheap query per path — a monitor that cost
// AI budget would compete with the product for the resource it protects, and a
// monitor expensive enough to be worth disabling gets disabled.
//
// Four outcomes, never collapsed into two (see lib/telemetry-freshness.ts):
//   STALE     — worked, then stopped. The regression case. Alert.
//   SILENT    — never carried a row. Different fix. Alert.
//   UNCHECKED — the query failed. Logged as a warning, never counted as a pass.
//   FLOWING   — a row inside budget. Logged, so the checker's silence is
//               distinguishable from the checker never having run.
//
// Schedule: daily 06:45 UTC (scripts/install-hetzner-crons.sh), between the
// model-rot check and the 08:00 digest.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { refreshOrInsertActiveAlert, dismissActiveAlertsByType } from "@/db/queries/alerts";
import { getDefaultUser } from "@/db/queries/users";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";
import { checkTelemetryFreshness, describeBroken, humanizeAge } from "@/lib/telemetry-freshness";

const ALERT_TYPE = "telemetry_stale";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const report = await checkTelemetryFreshness();
  const broken = report.broken.length;
  const unchecked = report.unchecked.length;

  let alerted = false;
  const owner = await getDefaultUser();

  if (broken > 0 && owner) {
    const detail = describeBroken(report);
    const { created } = await refreshOrInsertActiveAlert({
      userId: owner.id,
      type: ALERT_TYPE,
      severity: "urgent",
      title:
        broken === 1
          ? "Activity stopped recording one kind of event"
          : `Activity stopped recording ${broken} kinds of event`,
      description:
        `Activity, digests and run history are missing recent work, so they look calmer ` +
        `than things are. The fix is in the code that writes these records.\n\n` +
        `These paths should be receiving rows and are not:\n${detail}\n\n` +
        `A sensor that reports nothing looks exactly like a system with nothing to report.`,
      actionUrl: "/system",
      metadata: {
        broken: report.broken.map((r) => ({
          table: r.table,
          state: r.state,
          ageHours: r.ageHours,
          writer: r.writer,
        })),
        unchecked: report.unchecked.map((r) => r.table),
      },
    });
    alerted = true;
    // Out-of-band ping once per episode, not on every daily tick — a repeated
    // alarm for a known condition is trained-out noise within a week.
    if (created) {
      const tg = selfTelegramTarget();
      if (tg) {
        void sendTelegramMessage(
          tg,
          `🚨 Loki: ${broken} telemetry path(s) stopped recording.\n${detail}`,
        );
      }
    }
  } else if (broken === 0 && unchecked === 0 && owner) {
    // Auto-resolve. Without this the alert outlives the fault and the operator
    // learns that alerts on this surface do not mean anything current.
    await dismissActiveAlertsByType(owner.id, ALERT_TYPE);
  }

  await logDebug({
    source: "crons/check-telemetry",
    level: broken > 0 ? "error" : unchecked > 0 ? "warn" : "info",
    message:
      broken > 0
        ? `TELEMETRY STALE: ${report.broken.map((r) => `${r.table} (${humanizeAge(r.ageHours)})`).join(", ")}`
        : unchecked > 0
          ? `${report.flowingCount}/${report.monitoredCount} monitored path(s) flowing; ${unchecked} UNCHECKED (query failed) — not a pass for those`
          : `All ${report.monitoredCount} monitored telemetry path(s) carrying traffic`,
    meta: {
      broken,
      unchecked,
      flowing: report.flowingCount,
      paths: report.results.map((r) => ({ table: r.table, state: r.state, ageHours: r.ageHours })),
    },
  });

  return NextResponse.json({
    ok: broken === 0,
    broken,
    unchecked,
    flowing: report.flowingCount,
    alerted,
    paths: report.results.map((r) => ({
      table: r.table,
      state: r.state,
      age: humanizeAge(r.ageHours),
    })),
  });
}
