/**
 * POST /api/orangecat/task — OrangeCat sends one task to several of the
 * person's Loki projects.
 *
 * Lives under /api/orangecat/ because that prefix IS the auth decision: the
 * proxy exempts it so the receiver can verify its own HMAC (see the header of
 * ../site/route.ts for the deploy that learned this). Same rail, same secret,
 * same fail-closed posture as /api/orangecat/site.
 *
 * The body names an OrangeCat actor, and the task runs as the Loki user linked
 * to that actor — never as anyone else. An actor with no linked Loki account is
 * refused with a sentence that names the next step, because dispatching into
 * someone's repositories is not something to attribute to a default account.
 *
 * Each sent project answers with its `runId` and a `statusUrl`, so the caller
 * can follow the run it started (and read it back over
 * /api/orangecat/sessions). `builderChannel: "cloud"` asks for the always-on
 * runner. A project that already has an open run refuses the whole task with
 * 409 and a sentence, unless the body says `queueIfBusy` (wait behind the open
 * run). `session: "fresh"` (or the older `separateSession: true`) gives each
 * project a one-off session of its own for this task: a new agent in its own
 * worktree, closed when it reports, never typed into the project's shared
 * session, busy or not. Without a lane of its own it is refused (409).
 *
 * Every close outcome is announced: the person typed this into OrangeCat and
 * is not watching a Loki tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { logDebug } from "@/db/queries/debug-logs";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { dispatchToProjects } from "@/lib/multi-project-dispatch";
import { MAX_TASK_LENGTH, MAX_TASK_PROJECTS } from "@/lib/multi-dispatch-prompt";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { getExecutionAccess } from "@/lib/execution-access";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";

const Body = z.object({
  actorId: z.string().uuid(),
  task: z.string().trim().min(1).max(MAX_TASK_LENGTH),
  projects: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(MAX_TASK_PROJECTS * 2),
  /** Prefer this builder ("cloud" = the always-on runner) where the project is not locked. */
  builderChannel: z.enum(BUILDER_CHANNELS).optional(),
  /** Queue behind a project's open run. Without it a busy project refuses the task (409). */
  queueIfBusy: z.boolean().optional(),
  /**
   * "fresh": a one-off session of its own for this task, in its own
   * worktree, closed when it reports (busy-placement.ts). For a question
   * that must neither wait for the open run nor be folded into it.
   */
  session: z.enum(["shared", "fresh"]).optional(),
  /** The first name of `session: "fresh"`; kept so a caller that sends it still gets it. */
  separateSession: z.boolean().optional(),
  /** Where on OrangeCat this was sent from — for attribution, not routing. */
  originUrl: z.string().trim().url().max(500).optional(),
  /**
   * When the request was signed. A task starts agents, so a captured request
   * must not be replayable: when present it must be within the same window as
   * the read doors. Optional only until every OrangeCat sends it.
   */
  issuedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "task dispatch not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, task, projects, originUrl, builderChannel, queueIfBusy, separateSession } =
    dataOrResp;
  const session = separateSession ? "fresh" : dataOrResp.session;
  if (dataOrResp.issuedAt && !isFreshIssuedAt(dataOrResp.issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  const user = await getUserByOrangeCatActorId(actorId);
  if (!user) {
    return NextResponse.json(
      {
        error: "no linked Loki account",
        detail:
          "This OrangeCat identity is not linked to a Loki account yet. Sign in to Loki with the same OrangeCat identity once, then try again.",
      },
      { status: 409 },
    );
  }

  // The cloud runner is not every account's to use: the same check the
  // transcript stream makes before it names that builder.
  if (builderChannel === "cloud") {
    const access = await getExecutionAccess(user.id);
    if (!access.cloudBuilderAllowed) {
      return NextResponse.json(
        {
          error: "cloud runner not available",
          detail:
            "The cloud runner is private for this account. Nothing was sent. Send the task without naming a builder.",
        },
        { status: 403 },
      );
    }
  }

  const result = await dispatchToProjects(
    {
      task,
      projects,
      notifyOnClose: true,
      ...(builderChannel ? { builderChannel } : {}),
      // A person on OrangeCat is not watching Control: a busy project answers
      // with a sentence unless they asked to queue behind the open run.
      refuseBusy: !queueIfBusy,
      ...(session ? { session } : {}),
    },
    user.id,
  );

  await logDebug({
    source: "orangecat/task",
    level: result.ok ? "info" : "warn",
    message: result.ok
      ? `task from OrangeCat sent to ${result.sent}/${result.results.length} projects`
      : "task from OrangeCat refused",
    meta: { actorId, userId: user.id, projects, originUrl, taskLength: task.length },
  }).catch(() => {});

  if (!result.ok) {
    return NextResponse.json({ ...result, detail: result.error }, { status: result.status });
  }
  return NextResponse.json(result, { status: 200 });
}
