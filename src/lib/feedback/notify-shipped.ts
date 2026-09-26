/**
 * Tell the operator when a fix reached the live site — or failed on the way.
 *
 * The loop already announced two things: a visitor filed something
 * (notify-new.ts), and an agent's RUN closed (notify-close.ts). Neither is the
 * event a person actually cares about. A run closes at a pull request; the
 * product changes later, when that pull request merges and deploys. So the
 * operator was told "the agent finished" — the exact claim the fix ledger
 * exists to stop making — and told nothing at all when the change went live.
 *
 * That gap turned dangerous the moment "ship fixes automatically" shipped:
 * Loki now merges and deploys onto a live site with nobody watching. A
 * deploy that fails after an automatic merge is the single worst state this
 * system can produce, and until now it was silent.
 *
 * Fires on a TRANSITION only, so each fix announces each state at most once.
 * deployed is terminal. deploy_failed is not: a later deploy of the base branch
 * heals it into deployed (healDeployFailed), which announces "live" ONCE — on
 * purpose, because the operator was already told it failed and is owed the
 * correction. It can never re-announce "deploy failed": healing only moves
 * away from that state, and deployed is never recomputed.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { logDebug } from "@/db/queries/debug-logs";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";
import { APP_URL } from "@/config/brand";
import { refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import { type FixShipping } from "@/lib/feedback/fix-shipping";
import type { ShipAnnouncement } from "@/lib/feedback/fix-shipping";

/**
 * The two alert types raised here — must match src/config/alert-types.ts.
 *
 * Written as literal `type:` fields rather than a ternary at the call site
 * because scripts/test/alert-registry.ts reads the raised types by scanning
 * this file, and it FAILS on a file it cannot read instead of skipping it. A
 * gate that refuses to skip is the right kind of gate, so meet it where it
 * looks — and the branch reads better here anyway, since the severity differs
 * with the type.
 */
const FIX_LIVE_ALERT = { type: "fix_live", severity: "info" } as const;
const FIX_DEPLOY_FAILED_ALERT = { type: "fix_deploy_failed", severity: "warning" } as const;

export async function notifyFixShipped(input: {
  userId: string;
  projectId: string;
  feedbackExcerpt: string | null;
  announcement: ShipAnnouncement;
  fix: FixShipping;
  livePageUrl: string | null;
}): Promise<void> {
  try {
    const [project] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, input.projectId))
      .limit(1);
    const projectName = project?.name ?? "a project";
    const live = input.announcement === "live";
    const byFleet = input.fix.shippedByFleet === true;
    const inboxPath = `/feedback?project=${encodeURIComponent(projectName)}`;
    const what = input.feedbackExcerpt ? `“${input.feedbackExcerpt}”` : "a visitor's report";

    const title = live
      ? `${projectName} · a fix is live`
      : `${projectName} · a merged fix failed to deploy`;
    // Say who merged it. "Loki merged this while you were away" is the
    // fact an operator needs to trust — or switch off — automatic shipping.
    const viaLater = input.fix.liveVia === "later_deploy";
    const body = live
      ? viaLater
        ? `Its own deploy failed, but a later deploy of the site shipped it. Check it and confirm: ${what}`
        : `${byFleet ? "Merged automatically and deployed" : "Merged and deployed"}. Check it and confirm: ${what}`
      : `${input.fix.deploy?.name ?? "The deploy"} failed on the merge commit, so the site still shows the old version. ${what}`;

    const [pushResult] = await Promise.all([
      pushToUser(input.userId, {
        title,
        body,
        url: live && input.livePageUrl ? input.livePageUrl : inboxPath,
        tag: `${PUSH_TAG_PREFIX}fix-${input.projectId}`,
      }),
      (async () => {
        const target = selfTelegramTarget();
        if (!target) return;
        const lines = [
          live
            ? `✅ ${projectName}: a fix is live${byFleet ? " (merged automatically)" : ""}.`
            : `🚨 ${projectName}: a merged fix FAILED to deploy — the site still shows the old version.`,
          what,
          ...(input.fix.pr ? [input.fix.pr.url] : []),
          ...(input.fix.deploy?.url && !live ? [input.fix.deploy.url] : []),
          ...(live && input.livePageUrl ? [input.livePageUrl] : [`${APP_URL}${inboxPath}`]),
        ];
        await sendTelegramMessage(target, lines.join("\n")).catch(() => undefined);
      })(),
      refreshOrInsertActiveAlert({
        userId: input.userId,
        ...(live ? FIX_LIVE_ALERT : FIX_DEPLOY_FAILED_ALERT),
        title,
        description: body,
        actionUrl: live && input.livePageUrl ? input.livePageUrl : inboxPath,
      }),
    ]);

    // Same contract as the other two notifiers: an announcement that reached
    // NOBODY is a product failure worth a log line, not a silent no-op.
    if (pushResult.sent === 0 && !selfTelegramTarget()) {
      void logDebug({
        source: "feedback/notify-shipped",
        level: "warn",
        message: `fix ${input.announcement} on ${projectName} reached no channel (push: ${pushResult.reason ?? "none"}, telegram: unconfigured)`,
      });
    }
  } catch (e) {
    void logDebug({
      source: "feedback/notify-shipped",
      level: "warn",
      message: `shipped notify failed: ${(e as Error).message}`,
    });
  }
}
