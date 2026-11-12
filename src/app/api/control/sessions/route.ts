/**
 * GET /api/control/sessions — a person's agent sessions, read with their own
 * browser session or `ck_` token.
 *
 * The same reads OrangeCat's signed rail answers with (lib/session-reads.ts),
 * so an agent that starts Claude Code in a session (tab-inject) can follow it
 * the way the person does on Control and Watch:
 *
 *  - no query: the projects' sessions, one row each (canonical state, the
 *    task in a line, the road to live, `openUrl` into Loki's Terminal), at
 *    most 25 with what needs the person first; `total` says how many exist.
 *  - `?runId=`: that one run, with the owner's full track and the agent's
 *    handoff once it reports; `&items=` adds the end of that run's own
 *    conversation, `&watch=<seconds>` (at most 300) holds the session as a
 *    viewer so the runner keeps streaming it, `&poll=1` never looks at GitHub.
 *  - `?project=`: that project's row and the last `items` (default 12, at
 *    most 40) things said in its conversation.
 *
 * Read only. A plain shell is never a row here: rows are projects and their
 * runs, and a shell is neither.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { SESSIONS_MAX_ITEMS } from "@/lib/integrations/orangecat-sessions";
import { WATCH_MAX_SECONDS } from "@/lib/integrations/orangecat-watch";
import { readSessions } from "@/lib/session-reads";

export const dynamic = "force-dynamic";

const Query = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  runId: z.string().uuid().optional(),
  items: z.coerce.number().int().min(1).max(SESSIONS_MAX_ITEMS).optional(),
  /** With runId: hold the run's session as a viewer for this many seconds. */
  watch: z.coerce.number().int().min(1).max(WATCH_MAX_SECONDS).optional(),
  /** With runId: a follower's poll, which never looks at GitHub. */
  poll: z.enum(["1", "true"]).optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    project: params.get("project") ?? undefined,
    runId: params.get("runId") ?? undefined,
    items: params.get("items") ?? undefined,
    watch: params.get("watch") ?? undefined,
    poll: params.get("poll") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}` },
      { status: 400 },
    );
  }

  try {
    const { poll, ...query } = parsed.data;
    const { status, body } = await readSessions(userId, { ...query, poll: Boolean(poll) });
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[control/sessions] failed:", (err as Error).message);
    return NextResponse.json({ error: "sessions failed" }, { status: 500 });
  }
}
