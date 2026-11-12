import { runBranches } from "@/lib/run-branches";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";
import { addMessage } from "@/db/queries/conversations";
import { logDebug } from "@/db/queries/debug-logs";
import { getGithubToken } from "@/lib/github-token";
import { findRepoWorkEvidence } from "@/lib/github-evidence";
import { repoTokenFor } from "@/lib/run-evidence-live";
import { reportedPrEvidence } from "@/lib/repo-evidence";
import { formatRunOutcomeMessage } from "@/lib/orchestration/run-outcome-format";
import { getFeedbackByRunId } from "@/db/queries/site-feedback";
import { fetchFixNote } from "@/lib/feedback/fix-note-fetch";
import { projectUpdatesThreadId } from "@/lib/loki/updates-thread";
import { feedbackScreenshotPath } from "@/lib/loki/update-images";
import type { OrchestrationRun } from "@/db/schema/orchestration-runs";

/**
 * Write a closed run's outcome into the conversation that dispatched it.
 *
 * Runs opt in by carrying payload.conversationId (set by the /loki messages
 * route). A run started from the feedback inbox has no chat behind it and
 * reports into its project's updates thread instead (updates-thread.ts), so
 * every fix a person asked for is told back where they can see the whole
 * story. Autopilot and cron runs stay silent, as they always were. Repo evidence is looked up best-effort the same way the reaper does
 * (a PR or push in the run's window), because the agent's own handoff is a
 * claim and the pull request is the thing that will actually merge and deploy.
 *
 * Fire-and-forget by contract, like notifyRunClosed: never throws, never slows
 * a close.
 */
export async function postRunOutcomeToConversation(run: OrchestrationRun): Promise<void> {
  let conversationId = run.payload?.conversationId ?? null;
  try {
    const feedback = await getFeedbackByRunId(run.userId, run.id).catch(() => null);
    if (!conversationId && feedback) {
      conversationId = await projectUpdatesThreadId(run.userId, run.projectKey);
    }
    if (!conversationId) return;
    const project = await db.query.userProjects.findFirst({
      where: and(
        eq(userProjects.userId, run.userId),
        sql`(lower(${userProjects.slug}) = lower(${run.projectKey}) OR lower(${userProjects.name}) = lower(${run.projectKey}))`,
      ),
      columns: { gitUrl: true, liveUrl: true },
    });

    let evidence = run.payload?.evidence ?? null;
    // The runner's own report comes first: it closed this run on a pull
    // request it saw at the agent's HEAD (closeRunShipped). Nothing read it,
    // so a run that shipped could be posted as "no pull request was found".
    evidence ??= reportedPrEvidence(
      run.payload,
      (run.finishedAt ?? run.startedAt ?? new Date()).getTime(),
    );
    // The token that can read this repository, as the fix ledger and the
    // live evidence pick it. A person's own OAuth token is refused on the
    // organisation's repositories (github-org-token.ts), so asking with it
    // found nothing and a good run read "the work may not have left the runner".
    const token = project?.gitUrl
      ? await repoTokenFor(run.userId, project.gitUrl).catch(() => null)
      : await getGithubToken(run.userId).catch(() => null);
    if (!evidence && project?.gitUrl && run.startedAt) {
      if (token) {
        evidence = await findRepoWorkEvidence(
          project.gitUrl,
          token,
          run.startedAt.getTime(),
          runBranches(run),
        ).catch(() => null);
      }
    }

    const note = evidence?.kind === "pr" ? await fetchFixNote(evidence.url, token) : null;
    const message = formatRunOutcomeMessage(run, {
      conversationId,
      evidence,
      liveUrl: project?.liveUrl ?? null,
      note,
      asked: feedback?.suggestion ?? null,
      images: feedback?.screenshots?.length
        ? [
            {
              src: feedbackScreenshotPath(feedback.id, 0),
              caption: "What it looked like when it was reported",
            },
          ]
        : [],
    });
    if (!message) return;
    await addMessage(conversationId, {
      role: "assistant",
      kind: "outcome",
      content: message.content,
      meta: message.meta,
    });
  } catch (e) {
    void logDebug({
      source: "orchestration/run-outcome-post",
      level: "warn",
      message: `could not post outcome of run ${run.id} to conversation ${conversationId}: ${(e as Error).message}`,
    });
  }
}
