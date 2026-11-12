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
 *  - `?runId=`: that one run, with the owner's full track.
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
import { readSessions } from "@/lib/session-reads";

export const dynamic = "force-dynamic";

const Query = z.object({
  project: z.string().trim().min(1).max(120).optional(),
  runId: z.string().uuid().optional(),
  items: z.coerce.number().int().min(1).max(SESSIONS_MAX_ITEMS).optional(),
});

export async function GET(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    project: params.get("project") ?? undefined,
    runId: params.get("runId") ?? undefined,
    items: params.get("items") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}` },
      { status: 400 },
    );
  }

  try {
    const { status, body } = await readSessions(userId, parsed.data);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[control/sessions] failed:", (err as Error).message);
    return NextResponse.json({ error: "sessions failed" }, { status: 500 });
  }
}
