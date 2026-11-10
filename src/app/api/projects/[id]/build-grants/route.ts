import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody, jsonOk, jsonError, z } from "@/lib/api/route-helpers";
import { getUserProjectByEntityId, setProjectBuildGrants } from "@/db/queries/user-projects";

/**
 * Who may START a build on this project's builder, beyond the owner's own
 * word. Two switches, both OWNER-ONLY (a session, matched to the project's
 * owner row) and both off until chosen:
 *
 *  - agentBuildsUnasked: an agent's report (source "agent") builds at once.
 *  - editorsMayBuild: an editor may use Implement/dispatch on the owner's
 *    builder. Without it only the owner's word starts a build ("whoever asks
 *    pays, in their own builder", docs/architecture/private-builders.md).
 *
 * Filing never builds under either switch except agentBuildsUnasked.
 * null is a real answer: never chosen.
 */
const Body = z
  .object({ agentBuildsUnasked: z.boolean().optional(), editorsMayBuild: z.boolean().optional() })
  .refine((b) => b.agentBuildsUnasked !== undefined || b.editorsMayBuild !== undefined, {
    message: "Nothing to update",
  });

const shape = (p: { agentBuildsUnasked: boolean | null; editorsMayBuild: boolean | null }) => ({
  agentBuildsUnasked: p.agentBuildsUnasked ?? null,
  editorsMayBuild: p.editorsMayBuild ?? null,
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const project = await getUserProjectByEntityId(userId, idOrResp);
  if (!project) return jsonError("Project not found", 404);
  return jsonOk(shape(project));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const data = await readJsonBody(req, Body);
  if (data instanceof NextResponse) return data;
  const updated = await setProjectBuildGrants(userId, idOrResp, data);
  if (!updated) return jsonError("Project not found", 404);
  return jsonOk(shape(updated));
}
