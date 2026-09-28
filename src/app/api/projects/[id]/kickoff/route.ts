import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { getProjectCore } from "@/db/queries/projects";
import { KICKOFF_STEPS } from "@/lib/project-kickoff";
import { DOC_PASTE_MAX } from "@/lib/constants";
import { PASTE_TOO_LONG } from "@/lib/api/pasted-text";
import { getServerKickoff, startServerKickoff } from "@/lib/kickoff/server-runs";

/**
 * "Make it happen", run by the server.
 *
 * POST starts the run (or joins the one already going) and answers at once;
 * the steps continue after the response via `after()`, so a phone that locks
 * its screen or closes the tab cannot stop them. GET is what the page polls.
 * See lib/kickoff/server-runs for why the progress lives in memory.
 */

const KickoffBody = z.object({
  plan: z.array(z.enum(KICKOFF_STEPS)).min(1).max(KICKOFF_STEPS.length),
  // Same ceiling as the steps it feeds (pastedText); the floor is theirs to enforce.
  source: z.string().trim().max(DOC_PASTE_MAX, PASTE_TOO_LONG).nullable(),
  visibility: z.enum(["private", "public"]).default("private"),
  names: z.array(z.string().max(300)).max(4).default([]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, KickoffBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Order is the orchestrator's, not the caller's: dedupe and keep canonical order.
  const plan = KICKOFF_STEPS.filter((s) => dataOrResp.plan.includes(s));
  const { run, done, joined } = startServerKickoff(userId, {
    projectId: idOrResp,
    names: [project.name, ...dataOrResp.names],
    plan,
    source: dataOrResp.source,
    visibility: dataOrResp.visibility,
  });
  after(() => done);
  return NextResponse.json({ ok: true, joined, run });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  return NextResponse.json(
    { ok: true, run: getServerKickoff(userId, idOrResp) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
