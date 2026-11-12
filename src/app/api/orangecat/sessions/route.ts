/**
 * POST /api/orangecat/sessions — OrangeCat reads one person's agent sessions.
 *
 * Same signed rail, same fail-closed posture and the same freshness window as
 * /api/orangecat/actor-status; the contract and the shaping live in
 * lib/integrations/orangecat-sessions.ts. Everything is read as the Loki user
 * linked to the OrangeCat actor in the body, never as anyone else.
 *
 * Three reads on one door:
 *  - no `project`, no `runId`: the projects' sessions, one row each, at most
 *    25 with what needs the person first; `total` says how many exist.
 *  - `runId`: that one run, with the owner's full track (pull request, merge,
 *    deploy, live) and the agent's handoff once it reports. With `items`,
 *    also the last things said in THAT run's own session (a one-off or a
 *    parallel lane has its own tab). With `watch` (seconds), the bot follows
 *    the run: it holds the session as a viewer for that long, so the runner
 *    streams the conversation while the agent works (orangecat-watch.ts).
 *  - `project`: that project's row plus the last `items` things said in its
 *    Claude Code conversation.
 *
 * The reads themselves, and how fresh a conversation is, are
 * lib/session-reads.ts, shared with the person's own token
 * (/api/control/sessions).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import { SESSIONS_MAX_ITEMS } from "@/lib/integrations/orangecat-sessions";
import { WATCH_MAX_SECONDS } from "@/lib/integrations/orangecat-watch";
import { readSessions } from "@/lib/session-reads";

export const dynamic = "force-dynamic";

const Body = z.object({
  actorId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  project: z.string().trim().min(1).max(120).optional(),
  runId: z.string().uuid().optional(),
  items: z.number().int().min(1).max(SESSIONS_MAX_ITEMS).optional(),
  /** With runId: hold the run's session as a viewer for this many seconds. */
  watch: z.number().int().min(1).max(WATCH_MAX_SECONDS).optional(),
  /**
   * With runId: a follower's poll. The run's own facts and its cached ledger
   * only, never a look at GitHub: a bot polling every few seconds must not
   * spend the owner's GitHub budget (run-track-load's ownerView).
   */
  poll: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "sessions not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, issuedAt, project, runId, items, watch, poll } = dataOrResp;

  // Signed, but with no nonce: without this a captured request replays forever.
  if (!isFreshIssuedAt(issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(actorId);
    if (!user) {
      return NextResponse.json({ ok: true, linked: false, sessions: [] });
    }
    const { status, body } = await readSessions(user.id, { project, runId, items, watch, poll });
    return NextResponse.json(status === 200 ? { ...body, linked: true } : body, { status });
  } catch (err) {
    console.error("[orangecat/sessions] failed:", (err as Error).message);
    return NextResponse.json({ error: "sessions failed" }, { status: 500 });
  }
}
