import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { mergeVisibleProjects } from "@/lib/visible-projects";
import { getProjectStatesByUserId } from "@/db/queries/project-states";
import { getRecentOutcomesByProjectKeys } from "@/db/queries/orchestration-runs";
import { listFeedbackSummary } from "@/db/queries/site-feedback";
import { getOrangeCatLinksForUser } from "@/db/queries/orangecat-links";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { isFreshIssuedAt, shapeActorStatus } from "@/lib/integrations/orangecat-actor-status";

/**
 * OrangeCat asks what is happening to one person's Loki projects, so its
 * agent can say "your site is live" or "Loki is waiting on you" instead of
 * guessing. Same HMAC rail and fail-closed semantics as the sibling
 * /api/orangecat routes; the shaping and the contract live in
 * src/lib/integrations/orangecat-actor-status.ts.
 */
const Body = z.object({
  actorId: z.string().uuid(),
  issuedAt: z.string().datetime(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "actor-status not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, issuedAt } = dataOrResp;

  // The body is signed but carries no nonce: a captured request would replay
  // forever without this. Five minutes absorbs clock skew between the boxes.
  if (!isFreshIssuedAt(issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(actorId);
    if (!user) {
      return NextResponse.json({ ok: true, linked: false, projects: [] });
    }

    const [own, org, states, feedback, links] = await Promise.all([
      getUserProjects(user.id).catch(() => []),
      getOrgProjects(user.id).catch(() => []),
      getProjectStatesByUserId(user.id).catch(() => []),
      listFeedbackSummary(user.id).catch(() => []),
      getOrangeCatLinksForUser(user.id).catch(() => []),
    ]);
    const projects = mergeVisibleProjects(own, org);
    const outcomes = await getRecentOutcomesByProjectKeys(
      user.id,
      projects.map((p) => p.name),
    ).catch(() => new Map<string, string[]>());

    return NextResponse.json({
      ok: true,
      linked: true,
      generatedAt: new Date().toISOString(),
      projects: shapeActorStatus({ projects, states, outcomes, feedback, links }),
    });
  } catch (err) {
    console.error("[orangecat/actor-status] failed:", (err as Error).message);
    return NextResponse.json({ error: "status failed" }, { status: 500 });
  }
}
