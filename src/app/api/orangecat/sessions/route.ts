/**
 * POST /api/orangecat/sessions — OrangeCat reads one person's agent sessions.
 *
 * Same signed rail, same fail-closed posture and the same freshness window as
 * /api/orangecat/actor-status. Everything is read as the Loki user linked to
 * the OrangeCat actor in the body, never as anyone else, through the same
 * reads a person's own token uses (lib/session-reads.ts):
 *
 *  - no `project`, no `runId`: the projects' sessions, one row each, at most
 *    25 with what needs the person first; `total` says how many exist.
 *  - `runId`: that one run, with the owner's full track (pull request, merge,
 *    deploy, live).
 *  - `project`: that project's row plus the last `items` things said in its
 *    Claude Code conversation.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import { SESSIONS_MAX_ITEMS } from "@/lib/integrations/orangecat-sessions";
import { readSessions } from "@/lib/session-reads";

export const dynamic = "force-dynamic";

const Body = z.object({
  actorId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  project: z.string().trim().min(1).max(120).optional(),
  runId: z.string().uuid().optional(),
  items: z.number().int().min(1).max(SESSIONS_MAX_ITEMS).optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "sessions not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, issuedAt, project, runId, items } = dataOrResp;

  // Signed, but with no nonce: without this a captured request replays forever.
  if (!isFreshIssuedAt(issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(actorId);
    if (!user) {
      return NextResponse.json({ ok: true, linked: false, sessions: [] });
    }
    const { status, body } = await readSessions(user.id, { project, runId, items });
    return NextResponse.json(status === 200 ? { ...body, linked: true } : body, { status });
  } catch (err) {
    console.error("[orangecat/sessions] failed:", (err as Error).message);
    return NextResponse.json({ error: "sessions failed" }, { status: 500 });
  }
}
