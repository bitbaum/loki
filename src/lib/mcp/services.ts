/**
 * The real McpServices — each one the function the matching HTTP route calls.
 *
 *   ask               → askLoki            (POST /api/loki)
 *   pendingApprovals  → getPendingActions  (GET  /api/actions/pending)
 *   decide            → decideAction       (POST /api/actions/[id]/decision)
 *   dispatch          → injectPrompt       (POST /api/inject, as the skill calls it)
 *   book              → enqueueAction      (POST /api/actions/propose, as `book` calls it)
 *   projects          → getUserProjects    (the list inject resolves names against)
 *
 * The only module under lib/mcp that touches the database; the route is its
 * only importer, so the dispatcher and tools stay loadable without one.
 */
import { askLoki } from "@/lib/loki-core";
import { injectPrompt } from "@/lib/inject-core";
import { getPendingActions } from "@/db/queries/actions";
import { getUserProjects } from "@/db/queries/user-projects";
import { getProjectsLastDispatch } from "@/db/queries/projects";
import { decideAction } from "@/lib/actions/decide-action";
import { enqueueAction } from "@/lib/actions/enqueue-action";
import { enqueueReport } from "@/lib/actions/enqueue-report";
import { ACTION_TYPE } from "@/lib/constants/statuses";
import type { BookRequest, McpServices } from "@/lib/mcp/types";

/**
 * The event payload the calendar drain books from — the same fields the
 * Telegram skill's `book` sends. A bare date is an all-day event.
 */
function eventPayload(req: BookRequest): Record<string, unknown> {
  const when = /^\d{4}-\d{2}-\d{2}$/.test(req.start)
    ? { eventDate: req.start, allDay: true }
    : { eventStart: req.start, ...(req.end ? { eventEnd: req.end } : {}) };
  return {
    eventTitle: req.title,
    ...when,
    ...(req.location ? { eventLocation: req.location } : {}),
  };
}

export const lokiMcpServices: McpServices = {
  ask: (userId, message, { sessionKey, readOnly }) =>
    askLoki(message, { userId, sessionKey, readOnly }),

  pendingApprovals: async (userId) =>
    (await getPendingActions(userId)).map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      description: a.description,
      reasoning: a.reasoning,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    })),

  decide: (userId, actionId, decision, extra) => decideAction(userId, actionId, decision, extra),

  // notifyOnClose: the person is not watching a Loki tab — the outcome has to
  // come to them, exactly as it does for a dispatch asked for in Telegram.
  dispatch: (userId, project, task) =>
    injectPrompt({ tab: project, customPrompt: task, notifyOnClose: true }, userId),

  // operatorRequested: the owner asked for this in words, just now, through
  // the app they connected — the per-item card is what they would expect.
  book: async (userId, req) =>
    enqueueReport(
      await enqueueAction(
        userId,
        { type: ACTION_TYPE.CREATE_EVENT, title: req.title, payload: eventPayload(req) },
        { operatorRequested: true },
      ),
    ),

  projects: async (userId) => {
    const [projects, lastDispatch] = await Promise.all([
      getUserProjects(userId),
      getProjectsLastDispatch(userId).catch(() => ({}) as Record<string, string>),
    ]);
    return projects.map((p) => ({
      name: p.name,
      description: p.description,
      liveUrl: p.liveUrl,
      builderPref: p.builderPref,
      lastDispatchAt: p.entityProjectId ? (lastDispatch[p.entityProjectId] ?? null) : null,
    }));
  },
};
