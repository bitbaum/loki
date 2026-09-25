// Cron target — model-rot detector.
//
// On 2026-08-18 Groq removed `llama-3.3-70b-versatile`. Loki kept asking
// for it for EIGHT DAYS: the frontier digest, the proposal generator, activity
// digests, calendar extraction and voice-adjacent paths all 404'd, and nothing
// said so. `npm run check:models` already answered the question — but it was a
// command a human had to remember to type, which is not automation. This is
// the clock typing it.
//
// Deliberately ZERO tokens: one GET /models per provider, no inference. The
// Groq free tier is 100k tokens/DAY org-wide across every feature, so a
// monitor that spent tokens would compete with the product for the very
// resource it exists to protect — and could itself cause the exhaustion it
// is meant to detect.
//
// Three outcomes, never collapsed into two:
//   ROT       — a pin is absent from a catalogue we READ. Alert, loudly.
//   UNCHECKED — we could not read the catalogue. Logged as a warning, never
//               alerted-as-rot and never counted as a pass.
//   OK        — every pin present. Logged, so the checker's own silence is
//               distinguishable from "nothing was ever checked".
//
// Schedule: daily 06:30 UTC (scripts/install-hetzner-crons.sh).

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import { getDefaultUser } from "@/db/queries/users";
import { sendTelegramMessage, selfTelegramTarget } from "@/lib/actions/telegram-send";
import { checkRegisteredModels, describeRot, fetchCatalog } from "@/lib/model-check";

const ALERT_TYPE = "model_rot";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  // No callability probe: that is a real completion, and a timer may not spend
  // the shared free tier. Catalogue reads only (GET /models, no inference).
  const report = await checkRegisteredModels(fetchCatalog);
  const rotted = report.missing.length;
  const unchecked = report.uncheckedIds.length;
  // A pin the provider still lists but REFUSES to serve on the request we build
  // is dead in exactly the way rot is dead, so it is counted with it. Splitting
  // them into a softer category is how qwen3.6-27b sat "present" for as long as
  // it did while the judge panel ran on one lineage.
  const refused = report.rejected.length;
  const broken = rotted + refused;

  let alerted = false;
  if (broken > 0) {
    const owner = await getDefaultUser();
    if (owner) {
      const detail = describeRot(report);
      const { created } = await refreshOrInsertActiveAlert({
        userId: owner.id,
        type: ALERT_TYPE,
        severity: "urgent",
        title: `${broken} pinned AI model${broken === 1 ? " is" : "s are"} unusable`,
        description:
          `${rotted} removed from the provider, ${refused} still listed but refusing the request ` +
          `Loki builds. Every feature below is failing now, silently:\n${detail}\n\n` +
          `Fix: a removed id needs a live one in the constant it comes from; a refused id needs the ` +
          `request changed — the provider's message above names the parameter. Then re-run ` +
          `\`npm run check:models\`.`,
        actionUrl: "/system",
        metadata: {
          missing: report.missing.map((m) => ({
            id: m.id,
            provider: m.provider,
            usedFor: m.usedFor,
          })),
          rejected: report.rejected.map((r) => ({
            id: r.model.id,
            error: r.error,
            usedFor: r.model.usedFor,
          })),
          uncheckedIds: report.uncheckedIds,
        },
      });
      alerted = true;
      // Fire the out-of-band ping once per episode, not on every daily tick.
      if (created) {
        const tg = selfTelegramTarget();
        if (tg) {
          void sendTelegramMessage(
            tg,
            `🚨 Loki: ${broken} pinned AI model id(s) unusable ` +
              `(${rotted} gone, ${refused} refusing our request).\n${detail}\n\n` +
              `These features are dark until it is fixed.`,
          );
        }
      }
    }
  }

  // Heartbeat + audit on every outcome. A checker that only speaks when it
  // finds something cannot be distinguished from a checker that never ran.
  await logDebug({
    source: "crons/check-model-ids",
    level: broken > 0 ? "error" : unchecked > 0 ? "warn" : "info",
    message:
      broken > 0
        ? `MODEL ROT: ${rotted} pinned id(s) gone, ${refused} present-but-REFUSING our request — ` +
          [
            ...report.missing.map((m) => m.id),
            ...report.rejected.map((r) => `${r.model.id} (400)`),
          ].join(", ")
        : unchecked > 0
          ? `${report.presentCount} pinned id(s) present; ${unchecked} UNCHECKED (catalogue unreadable) — not a pass for those`
          : `All ${report.presentCount} pinned model id(s) exist at their provider`,
    meta: {
      rotted,
      refused,
      rejected: report.rejected.map((r) => ({ id: r.model.id, error: r.error })),
      unchecked,
      present: report.presentCount,
      providers: report.providers.map((p) => ({ provider: p.provider, reachable: p.reachable })),
    },
  });

  return NextResponse.json({
    ok: broken === 0,
    rotted,
    refused,
    unchecked,
    present: report.presentCount,
    alerted,
    missing: report.missing.map((m) => ({ id: m.id, provider: m.provider })),
    rejected: report.rejected.map((r) => ({ id: r.model.id, error: r.error })),
    uncheckedIds: report.uncheckedIds,
  });
}
