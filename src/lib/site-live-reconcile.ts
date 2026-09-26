import { and, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";
import { getProjectCore } from "@/db/queries/projects";
import { getRepoWriteToken } from "@/lib/github-org-token";
import { parseGithubRepoUrl } from "@/lib/github-provision";
import { checkProjectSiteDeployment } from "@/lib/site-cd-register";
import { selfTelegramTarget, sendTelegramMessage } from "@/lib/actions/telegram-send";
import { createOwnerPass, ownerSiteUrl } from "@/lib/feedback/owner-pass";
import { logDebug } from "@/db/queries/debug-logs";
import { isSiteOperator } from "@/db/queries/users";
import { pushToUser } from "@/lib/push-fanout";
import { PUSH_TAG_PREFIX } from "@/config/brand-storage";

/**
 * A site that went live AFTER registration is recorded as live.
 *
 * Registration writes the live URL only if the site is already answering at
 * that moment. Farmhouse's first deploy failed (the repo could not see the
 * box's address), a later one succeeded, and nothing ever looked again: the
 * project kept no live URL, its "Live" link fell back to the OrangeCat listing
 * page, and the owner — who should be told "your site is live, go look and
 * say what to change" — was told nothing (2026-09-26).
 *
 * This asks the same question registration asks (checkProjectSiteDeployment:
 * a green deploy of main AND a public response — a hostname alone is not a
 * site), for every project that has a repository but no live URL yet, and
 * says so ONCE when the answer turns into yes.
 */

/** Bounded per sweep: two GitHub calls and one fetch each. */
const MAX_PER_SWEEP = 25;

export type SiteLiveCheck = "now_live" | "not_live" | "skipped";

export async function reconcileSiteLiveUrl(
  userId: string,
  entityProjectId: string,
  userProjectId: string,
): Promise<SiteLiveCheck> {
  const project = await getProjectCore(userId, entityProjectId).catch(() => null);
  const parsed = project?.gitUrl ? parseGithubRepoUrl(project.gitUrl) : null;
  if (!project || !parsed) return "skipped";
  const token = (await getRepoWriteToken(userId).catch(() => null))?.token ?? null;
  if (!token) return "skipped";

  const result = await checkProjectSiteDeployment({
    userId,
    entityProjectId,
    userProjectId,
    projectName: project.name,
    repoFullName: `${parsed.owner}/${parsed.repo}`,
    githubToken: token,
  }).catch(() => null);
  if (!result || !("plan" in result) || result.deploymentStatus !== "live") return "not_live";

  // checkProjectSiteDeployment has just written the live URL; this is the one
  // transition from "no site" to "site", so it is announced exactly here.
  await announceSiteLive(userId, entityProjectId, project.name, result.plan.liveUrl);
  return "now_live";
}

async function announceSiteLive(
  userId: string,
  entityProjectId: string,
  name: string,
  liveUrl: string,
): Promise<void> {
  // The owner's own link: opening it readies the widget, and what they say
  // there gets built. It carries their pass, so it goes only to them.
  const link = ownerSiteUrl(liveUrl, createOwnerPass(entityProjectId, userId));
  await pushToUser(userId, {
    title: `${name} is live`,
    body: "Open it and say what to change in the widget — it gets built.",
    url: link,
    tag: `${PUSH_TAG_PREFIX}site-live-${entityProjectId}`,
  }).catch(() => undefined);
  // Telegram is the operator's own chat; another owner's link never goes there.
  const target = selfTelegramTarget();
  if (!target || !(await isSiteOperator(userId).catch(() => false))) return;
  await sendTelegramMessage(
    target,
    [
      `🌐 ${name} is live: ${liveUrl}`,
      "",
      "Open it from here and say what to change in the widget — it gets built:",
      link,
    ].join("\n"),
  ).catch(() => undefined);
}

/** The sweep: every project with a repository and no live URL yet. */
export async function reconcileSiteLiveUrls(): Promise<{ checked: number; madeLive: number }> {
  const rows = await db
    .select({
      id: userProjects.id,
      userId: userProjects.userId,
      entityProjectId: userProjects.entityProjectId,
    })
    .from(userProjects)
    .where(
      and(
        isNull(userProjects.liveUrl),
        isNotNull(userProjects.gitUrl),
        isNotNull(userProjects.entityProjectId),
      ),
    )
    .limit(MAX_PER_SWEEP);

  let madeLive = 0;
  for (const row of rows) {
    const outcome = await reconcileSiteLiveUrl(row.userId, row.entityProjectId!, row.id);
    if (outcome === "now_live") madeLive++;
  }
  if (madeLive) {
    await logDebug({
      source: "site-live-reconcile",
      level: "info",
      message: `${madeLive} site(s) went live after registration`,
      meta: { checked: rows.length, madeLive },
    }).catch(() => undefined);
  }
  return { checked: rows.length, madeLive };
}
