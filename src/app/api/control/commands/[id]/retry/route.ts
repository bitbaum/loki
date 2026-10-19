import { NextRequest, NextResponse } from "next/server";
import { retryFailedCommand } from "@/db/queries/pending-commands";
import { getApiUserId } from "@/lib/session";
import { isAgentId } from "@/lib/agent-registry";

// Re-enqueues a failed command so the runtime picks it up again — verbatim,
// or with `{ agent }` for the same work on an agent that builder has.
// POST /api/control/commands/:id/retry
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid command id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { agent?: unknown };
  const agent = typeof body.agent === "string" ? body.agent : undefined;
  if (agent !== undefined && !isAgentId(agent)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  const commandId = await retryFailedCommand(userId, id, agent);
  if (!commandId)
    return NextResponse.json({ error: "Command not found or not retryable" }, { status: 404 });
  return NextResponse.json({ ok: true, queued: true, commandId });
}
