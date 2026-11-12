import { NextRequest, NextResponse } from "next/server";
import { getCommandById } from "@/db/queries/pending-commands";
import { getApiActor } from "@/lib/session";
import { mayPeekTab } from "@/lib/peek-access";

/**
 * The answer to POST /api/control/peek-tab. Session or `ck_` token: the route
 * that asks has always taken a token, and this one took a session only, so an
 * agent could ask for a session's screen and never read it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cmd = await getCommandById(id);
  const tab = (cmd?.payload as { tab?: unknown } | null)?.tab;
  if (
    !cmd ||
    cmd.userId !== actor.userId ||
    cmd.type !== "peek_tab" ||
    typeof tab !== "string" ||
    !mayPeekTab(tab, actor.via)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!cmd.executedAt) {
    return NextResponse.json({ status: "pending" }, noStore);
  }

  const result = cmd.result as { ok?: boolean; text?: string; error?: string } | null;
  if (result?.ok) {
    return NextResponse.json({ status: "done", content: result.text ?? "" }, noStore);
  }

  return NextResponse.json({ status: "error", error: result?.error ?? "Peek failed" }, noStore);
}
