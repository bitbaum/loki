// Cron target — is any machine still running a Fleet Runner we replaced?
//
// WHY A CRON AND NOT JUST FLEET DOCTOR
// ------------------------------------
// The comparison also lives in Fleet Doctor, and on the hosted box Fleet Doctor
// runs NOTHING: `isRuntimeAvailable()` is false there, so the route returns a
// single "runs full checks only on the local install" warning and stops. A
// check that only exists in Doctor is therefore a check that never runs in
// production — verified by probing the live authenticated endpoint and getting
// back exactly one check named `runtime`. This clock is the live path.
//
// WHAT IT CATCHES
// ---------------
// Publishing a release is not a machine installing one, and Loki had no
// way to tell the difference. On 2026-08-26 the laptop reported 0.8.12 while
// the box ran box-0.8.13. That runner predates the inject-hardening from
// 2026-08-23 (c350623c), so it kept acking unverified injects as `ok: true`
// instead of failing fast — 29 runs were reaped an hour later and billed to the
// projects whose prompts went unanswered, which climbed escalation ladders that
// could not clear.
//
// Zero tokens, no network, no new data: FLEET_RUNNER_RELEASES already says what
// shipped and every runner reports its version on every heartbeat.
//
// Four states, and the two boring-looking ones are load-bearing:
//   BEHIND  — alert. Merged desktop work is inert on that machine.
//   UNKNOWN — logged as a warning, never counted as a pass.
//   AHEAD   — fine. The box builds from main, so it reaches a version before
//             that version is tagged; alerting would fire on every merge and
//             train the operator to ignore this surface.
//   CURRENT — fine.
//
// Schedule: daily 06:50 UTC (scripts/install-hetzner-crons.sh), right after the
// telemetry freshness check.

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { refreshOrInsertActiveAlert, dismissActiveAlertsByType } from "@/db/queries/alerts";
import { getDefaultUser } from "@/db/queries/users";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";
import { getRuntimeSnapshots } from "@/db/queries/runtime-snapshots";
import { runnerVersionStatus } from "@/lib/runner-version";

const ALERT_TYPE = "runner_version_stale";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const owner = await getDefaultUser();
  if (!owner) {
    return NextResponse.json({ ok: false, error: "no owner user" }, { status: 500 });
  }

  const snapshots = await getRuntimeSnapshots(owner.id).catch(() => null);

  // "Could not look" is not "everything is current". It gets its own outcome so
  // a failing query can never be read later as a clean bill of health.
  if (snapshots === null) {
    await logDebug({
      source: "crons/check-runner-version",
      level: "warn",
      message:
        "UNCHECKED: could not read runtime snapshots — runner freshness is unknown, not current",
    });
    return NextResponse.json({ ok: false, unchecked: true });
  }

  const readings = snapshots.map((s) => ({
    channel: s.channel ?? "unknown",
    ...runnerVersionStatus(s.runnerVersion),
  }));
  const behind = readings.filter((r) => r.state === "behind");
  const unknown = readings.filter((r) => r.state === "unknown");

  let alerted = false;

  if (behind.length > 0) {
    const detail = behind
      .map((r) => `${r.channel}: ${r.normalized} (published ${r.latest}, ${r.behindBy} behind)`)
      .join("\n");
    const { created } = await refreshOrInsertActiveAlert({
      userId: owner.id,
      type: ALERT_TYPE,
      severity: "warning",
      // Plain first paragraph (what is wrong, what to do), then the record:
      // the row shows the first and folds the rest under "Details" (owner,
      // 2026-10-19: the old text opened on "A machine on an old build does
      // not fail — it behaves plausibly…"). The cloud builder updates
      // itself, so only a computer of the owner's own gets "Get the update".
      ...versionAlertCopy(
        behind.map((r) => r.channel),
        detail,
      ),
      metadata: {
        behind: behind.map((r) => ({
          channel: r.channel,
          version: r.normalized,
          latest: r.latest,
        })),
      },
    });
    alerted = true;
    // Once per episode, not per tick — a daily ping about a known condition is
    // trained-out within a week, and then the surface is dead for real faults.
    if (created) {
      const tg = selfTelegramTarget();
      if (tg) {
        void sendTelegramMessage(tg, `⚠️ Loki: runner behind published release.\n${detail}`);
      }
    }
  } else if (unknown.length === 0) {
    // Auto-resolve only when every runner is genuinely accounted for. Clearing
    // it while some runner is UNKNOWN would turn "we cannot tell" into "fixed".
    await dismissActiveAlertsByType(owner.id, ALERT_TYPE);
  }

  await logDebug({
    source: "crons/check-runner-version",
    level: behind.length > 0 ? "error" : unknown.length > 0 ? "warn" : "info",
    message:
      behind.length > 0
        ? `RUNNER BEHIND: ${behind.map((r) => `${r.channel} ${r.normalized}<${r.latest}`).join(", ")}`
        : unknown.length > 0
          ? `${readings.length - unknown.length}/${readings.length} runner(s) verified current; ${unknown.length} UNKNOWN — not a pass`
          : `All ${readings.length} runner(s) at or ahead of the published release`,
    meta: {
      readings: readings.map((r) => ({
        channel: r.channel,
        state: r.state,
        version: r.normalized,
      })),
    },
  });

  return NextResponse.json({
    ok: behind.length === 0,
    behind: behind.length,
    unknown: unknown.length,
    alerted,
    runners: readings.map((r) => ({
      channel: r.channel,
      state: r.state,
      version: r.normalized,
      latest: r.latest,
    })),
  });
}

/** The words for "behind": a computer of yours needs you; the cloud builder
 *  updates itself once its agents are idle (drain-and-restart-runner.sh). */
function versionAlertCopy(
  channels: string[],
  detail: string,
): { title: string; description: string; actionUrl: string } {
  const computers = channels.filter((c) => c !== "cloud").length;
  const record =
    `\n\n${detail}\n\nAn old build does not fail outright; it behaves plausibly and ` +
    `slightly wrong, which is why this once went unnoticed for twelve days. The .deb ` +
    `updater can download but not apply (no sudo from userspace).`;
  if (computers === 0) {
    return {
      title: "The cloud runner is waiting to update",
      description:
        `It updates itself as soon as no agent is working, and new work waits a moment ` +
        `for that. Nothing to do unless this is still here in an hour.` +
        record,
      actionUrl: "/control",
    };
  }
  return {
    title:
      computers === 1
        ? "Fleet Runner needs an update on one computer"
        : `Fleet Runner needs an update on ${computers} computers`,
    description:
      `It is running an older version, so recent fixes are not on it yet. Install the ` +
      `latest from Download — on a .deb install, run the new installer yourself.` +
      record,
    actionUrl: "/download",
  };
}
