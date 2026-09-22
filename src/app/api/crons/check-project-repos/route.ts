// Cron target — does every project's stored repo still exist, and is it still
// called what we think it is called?
//
// WHY THIS EXISTS
// ---------------
// `git_url` is written once, when a project is registered, and then trusted
// forever. Nothing ever asked GitHub whether it was still true. Measured
// against production on 2026-09-22, eight of thirty-three stored repos were
// wrong: four pointed at repositories that no longer exist (three of them
// abandoned factory experiments), two more at a retired personal account that
// had been renamed, and two at deleted scratch repos.
//
// A stale git_url is not cosmetic. It is the address every agent dispatch,
// clone and CI lookup starts from, so the failure surfaces as a confusing
// build error inside a run the operator has already paid for, rather than as
// "this project points at nothing".
//
// THE ONE DISTINCTION THAT MATTERS
// --------------------------------
// GitHub already knows the difference between a repo that MOVED and one that
// is GONE, and Loki was throwing that away. A rename answers with a redirect
// and the new full_name — so Loki can just fix it, which is the "automatic
// fixing" being connected to GitHub is supposed to buy. A 404 cannot be
// repaired by a machine: the repo was deleted or made private, and the only
// honest response is to raise it and say so.
//
// So: moved → healed silently and logged. Gone → one alert, refreshed not
// duplicated. Unchecked (dead token, network) → neither, and explicitly NOT
// counted as healthy, because a checker that reports success when it could not
// look is how a surface quietly stops meaning anything.
//
// Schedule: daily 06:20 UTC (scripts/install-hetzner-crons.sh).

import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";
import { requireCronAuth } from "@/lib/cron-auth";
import { logDebug } from "@/db/queries/debug-logs";
import { dismissActiveAlertsByType, refreshOrInsertActiveAlert } from "@/db/queries/alerts";
import { getAllDistinctUserIds, getUserProjects } from "@/db/queries/user-projects";
import { getGithubToken } from "@/lib/github-token";
import { checkRepo, parseGithubRepo } from "@/lib/github-repo-ref";

const ALERT_TYPE = "project_repo_missing";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const userIds = await getAllDistinctUserIds();
  const summary = { checked: 0, healthy: 0, healed: 0, gone: 0, unchecked: 0, skipped: 0 };
  const healedDetail: Array<{ project: string; from: string; to: string }> = [];

  for (const userId of userIds) {
    const token = await getGithubToken(userId);
    if (!token) {
      // No linked GitHub account — nothing to ask, and nothing wrong.
      continue;
    }

    const projects = await getUserProjects(userId);
    const gone: Array<{ project: string; slug: string }> = [];
    let sawUnchecked = false;

    for (const project of projects) {
      const ref = parseGithubRepo(project.gitUrl);
      if (!ref) {
        // Null, blank, or a non-GitHub host. Not this checker's business.
        if (project.gitUrl) summary.skipped++;
        continue;
      }

      summary.checked++;
      const status = await checkRepo(ref, token);

      if (status.state === "ok") {
        summary.healthy++;
        continue;
      }

      if (status.state === "moved") {
        // Self-heal. This is the whole reason to be connected to GitHub.
        await db
          .update(userProjects)
          .set({ gitUrl: `https://github.com/${status.newSlug}`, updatedAt: new Date() })
          .where(eq(userProjects.id, project.id));
        summary.healed++;
        healedDetail.push({ project: project.name, from: status.slug, to: status.newSlug });
        continue;
      }

      if (status.state === "gone") {
        summary.gone++;
        gone.push({ project: project.name, slug: status.slug });
        continue;
      }

      summary.unchecked++;
      sawUnchecked = true;
      await logDebug({
        source: "crons/check-project-repos",
        level: "warn",
        message: `UNCHECKED ${status.slug}: ${status.reason}`,
        meta: { userId, project: project.name },
      });
    }

    if (gone.length > 0) {
      const detail = gone.map((g) => `${g.project} → ${g.slug}`).join("\n");
      await refreshOrInsertActiveAlert({
        userId,
        type: ALERT_TYPE,
        severity: "warning",
        title: `${gone.length} project${gone.length === 1 ? "" : "s"} point at a repository that is gone`,
        description:
          `GitHub returns 404 for these. The repo was deleted, made private, or ` +
          `renamed away without a redirect — none of which Loki can repair on its ` +
          `own, because there is nothing to redirect to.\n\n${detail}\n\n` +
          `Until this is fixed, any dispatch or clone for these projects starts ` +
          `from an address that does not resolve. Point the project at the right ` +
          `repo on /projects, or clear the field if it no longer has one.`,
        actionUrl: "/projects",
        metadata: { gone },
      });
    } else if (!sawUnchecked) {
      // Auto-resolve ONLY when every repo was actually reachable. Clearing the
      // alert after a tick that could not look would turn "we do not know" into
      // "fixed" — the exact move this file exists to avoid.
      await dismissActiveAlertsByType(userId, ALERT_TYPE);
    }
  }

  await logDebug({
    source: "crons/check-project-repos",
    level: summary.gone > 0 ? "error" : summary.unchecked > 0 ? "warn" : "info",
    message:
      `checked ${summary.checked} repo(s): ${summary.healthy} ok, ${summary.healed} healed, ` +
      `${summary.gone} gone, ${summary.unchecked} unchecked`,
    meta: { ...summary, healed: healedDetail },
  });

  return NextResponse.json({ ok: summary.gone === 0, ...summary, healedDetail });
}
