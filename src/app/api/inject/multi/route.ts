/**
 * POST /api/inject/multi — one task, several projects.
 *
 * Thin boundary over dispatchToProjects (lib/multi-project-dispatch.ts), which
 * sends each project through the same injectPrompt as /api/inject. Same auth
 * as /api/inject: a session, or an agent token acting for its person.
 */
import { NextRequest, NextResponse } from "next/server";
import { ORCHESTRATION_ADAPTER_IDS } from "@/lib/orchestration";
import { getApiActor } from "@/lib/session";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { shouldAnnounceOnClose } from "@/lib/orchestration/notify-close-format";
import { dispatchToProjects } from "@/lib/multi-project-dispatch";
import { MAX_TASK_LENGTH, MAX_TASK_PROJECTS } from "@/lib/multi-dispatch-prompt";

const Body = z.object({
  task: z.string().trim().min(1).max(MAX_TASK_LENGTH),
  // Validated again (deduped, capped) in the dispatcher; this only bounds the body.
  projects: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(MAX_TASK_PROJECTS * 2),
  adapter: z.enum(ORCHESTRATION_ADAPTER_IDS).optional(),
  notifyOnClose: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const actor = await getApiActor();
  if (!actor?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await dispatchToProjects(
    {
      task: dataOrResp.task,
      projects: dataOrResp.projects,
      adapter: dataOrResp.adapter,
      notifyOnClose: shouldAnnounceOnClose(actor, dataOrResp.notifyOnClose),
    },
    actor.userId,
  );
  return NextResponse.json(result, { status: result.status });
}
