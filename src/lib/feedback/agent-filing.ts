/**
 * One machine filing, and one read of where a report is — the bodies of
 * POST /api/projects/[id]/feedback and GET /api/feedback/[id]/status
 * (docs/foundation/LOOP-WALK.md, "Agent walk").
 *
 * They live here, not in the routes, because there are two doors to the same
 * inbox: a seat's own Bearer token, and the signed OrangeCat rail
 * (/api/orangecat/feedback), where a person's bot files as the Loki account
 * linked to that person. Two doors with two copies of the filing rules would
 * be two inboxes in everything but the table. Each door authenticates; this
 * decides what a filing is.
 */
import { z } from "zod";
import {
  findFeedbackByIdempotencyKey,
  getFeedbackWithProject,
  insertAgentFeedback,
  insertSiteFeedback,
} from "@/db/queries/site-feedback";
import { getRunsByIdsForReporter } from "@/db/queries/orchestration-runs";
import type { ProjectAccess } from "@/db/queries/project-access";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import { RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { appUrl } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { attachFeedbackWork, runToFeedbackSnapshot } from "./attach-work";
import { FeedbackAttachmentsSchema } from "./attachment-schema";
import { canonicalStatus, seatStatus } from "./canonical-status";
import { feedbackContentHash } from "./content-hash";
import { livePageHref } from "./fix-shipping";
import { notifyFeedbackReceived } from "./notify-new";
import { startOwnerBuild } from "./owner-build";
import { deriveFeedbackWork } from "./work-phase";

/** The words of a filing; attachments ride with it where a door accepts them. */
export const AgentFilingFields = {
  suggestion: z.string().trim().min(1).max(2000),
  /** What the agent calls itself ("qa-bot"): a label for the inbox, not an identity. */
  agentName: z.string().trim().min(1).max(80),
  /** The caller's retry key. The same key again returns the same row. */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  page: z.string().max(300).optional(),
  url: z.string().max(1000).optional(),
  pageTitle: z.string().max(300).optional(),
};

export const AgentFiling = z.object({ ...AgentFilingFields, ...FeedbackAttachmentsSchema });
export type AgentFilingInput = z.infer<typeof AgentFiling>;

/** Filings per seat per project per window, on every door together. */
const FILINGS_PER_WINDOW = 60;

export type FilingAnswer = {
  id: string;
  status: string;
  statusUrl: string;
  replayed: boolean;
  building?: boolean;
  buildNote?: string;
};

export type FilingOutcome =
  | { ok: true; status: 200 | 201; body: FilingAnswer }
  | { ok: false; status: 429 | 500; error: string };

/**
 * File one report as `reporterUserId`, who holds `access` on the project.
 * Filing is NOT permission to build: the row is `source: agent`, which waits
 * for a tap, unless the project's OWNER opted in to agent reports building.
 */
export async function fileAgentFeedback(
  reporterUserId: string,
  projectId: string,
  access: ProjectAccess,
  data: AgentFilingInput,
): Promise<FilingOutcome> {
  if (
    !checkRateLimit(
      `feedback:agent:${reporterUserId}:${projectId}`,
      FILINGS_PER_WINDOW,
      RATE_LIMIT_WINDOW_LONG_MS,
    )
  ) {
    return { ok: false, status: 429, error: "Too many submissions, try again later" };
  }

  const respond = (
    row: { id: string; status: string },
    replayed: boolean,
    build?: { building: boolean; buildNote?: string },
  ): FilingOutcome => ({
    ok: true,
    status: replayed ? 200 : 201,
    body: {
      id: row.id,
      status: row.status,
      statusUrl: `${appUrl()}/api/feedback/${row.id}/status`,
      replayed,
      ...build,
    },
  });

  if (data.idempotencyKey) {
    const seen = await findFeedbackByIdempotencyKey(projectId, data.idempotencyKey);
    if (seen) return respond(seen, true);
  }
  const values = {
    projectId,
    userId: access.ownerUserId,
    suggestion: data.suggestion,
    page: data.page ?? null,
    url: data.url ?? null,
    pageTitle: data.pageTitle ?? null,
    captureContext: data.context ?? null,
    screenshots: data.screenshots ?? null,
    selectedElements: data.selectedElements ?? null,
    moments: data.moments?.length ? data.moments : null,
    source: FEEDBACK_SOURCE.AGENT,
    agentName: data.agentName,
    reporterUserId,
    contentHash: feedbackContentHash(data.suggestion, data.page ?? null, data),
  };
  // Without a key there is nothing to replay: a plain insert.
  const stored = data.idempotencyKey
    ? await insertAgentFeedback({ ...values, idempotencyKey: data.idempotencyKey })
    : await insertSiteFeedback(values).then((row) => (row ? { row, replayed: false } : null));
  if (!stored)
    return { ok: false, status: 500, error: "Could not store feedback, try again later" };
  if (stored.replayed) return respond(stored.row, true);
  void notifyFeedbackReceived(stored.row);
  // Filing alone never builds. Only a project whose OWNER opted in ("agent
  // reports build unasked", default off) starts the build, on the owner's own
  // builder and daily limit, through the same path as the Implement button.
  const project = await getUserProjectByEntityId(access.ownerUserId, projectId).catch(() => null);
  if (project?.agentBuildsUnasked !== true) return respond(stored.row, false);
  const build = await startOwnerBuild(access.ownerUserId, projectId, stored.row.id);
  return respond(stored.row, false, build);
}

/**
 * Where one report is, for `userId`, in the six canonical states — or null
 * when it is not theirs to read. Two shapes, by seat, never one with holes:
 * an owner or editor gets the whole status; anyone else gets the seat status
 * for a report THEY filed (seatStatus: never empty on Needs you).
 */
export async function readFeedbackStatus(
  userId: string,
  feedbackId: string,
): Promise<Record<string, unknown> | null> {
  const row = await getFeedbackWithProject(userId, feedbackId);
  if (!row) return null;
  const { feedback } = row;

  if (row.canEdit) {
    const { screenshots, ...rest } = feedback;
    const [item] = await attachFeedbackWork(row.ownerUserId, [
      {
        ...rest,
        hasScreenshots: Boolean(screenshots?.length),
        liveUrl: row.liveUrl,
        runnable: row.hasWorkspace,
      },
    ]);
    const status = canonicalStatus(item.work, {
      liveUrl: livePageHref(row.liveUrl, feedback.url, feedback.page),
      feedbackId: feedback.id,
    });
    return { id: feedback.id, source: feedback.source, ...status };
  }

  if (feedback.reporterUserId !== userId) return null;
  const run = feedback.dispatchedRunId
    ? (await getRunsByIdsForReporter([feedback.dispatchedRunId])).get(feedback.dispatchedRunId)
    : null;
  const status = seatStatus(
    canonicalStatus(deriveFeedbackWork(feedback.status, runToFeedbackSnapshot(run)), {
      liveUrl: livePageHref(row.liveUrl, feedback.url, feedback.page),
    }),
  );
  return { id: feedback.id, source: feedback.source, ...status };
}
