/**
 * Thin HTTP boundary over the hosted-dispatch SSOT (src/lib/hosted-runner/dispatch.ts).
 * Lets the Control "Run in cloud" button send a coding task to the hosted Hermes
 * runner ON PURPOSE — regardless of whether the local Fleet Runner is online (the
 * inject auto-route only fires when it's offline). Parse → auth → delegate.
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { dispatchToHostedRunner } from "@/lib/hosted-runner/dispatch";
import { hostedRunnerServes } from "@/lib/hosted-runner/serves";

const HermesDispatchBody = z.object({
  projectKey: z.string().min(1).max(80),
  task: z.string().min(1).max(4000),
  model: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readJsonBody(req, HermesDispatchBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { projectKey, task, model } = dataOrResp;

  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  if (!(await hostedRunnerServes(userId)))
    return jsonError("The hosted runner does not serve this account.", 403);

  const res = await dispatchToHostedRunner({
    userId,
    projectKey,
    task,
    ...(model ? { model } : {}),
  });
  if (!res.ok) {
    return jsonError(
      res.error,
      res.status,
      res.knownProjects ? { knownProjects: res.knownProjects } : undefined,
    );
  }
  return jsonOk({
    hostedDispatchId: res.hostedDispatchId,
    projectName: res.projectName,
    gitUrl: res.gitUrl,
  });
}
