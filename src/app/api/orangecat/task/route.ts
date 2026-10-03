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

const Body = z.object({
  actorId: z.string().uuid(),
  task: z.string().trim().min(1).max(MAX_TASK_LENGTH),
  projects: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(MAX_TASK_PROJECTS * 2),
  /** Where on OrangeCat this was sent from — for attribution, not routing. */
  originUrl: z.string().trim().url().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "task dispatch not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, task, projects, originUrl } = dataOrResp;

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

  const result = await dispatchToProjects({ task, projects, notifyOnClose: true }, user.id);

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
