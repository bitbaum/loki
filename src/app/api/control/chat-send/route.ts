/**
 * A message from the conversation view that carries attachments.
 *
 * Plain chat lines go over the fast keystroke lane (tab-inject-raw), which has
 * no room for a picture: 4000 bytes a write, no durable row. A message with a
 * screenshot comes here instead and is delivered as an `inject` to the live
 * session — the runner writes each image to a file where the agent runs and
 * types the message with the files' paths in it, so Claude opens the actual
 * screenshot (lib/agent-attachments). The words go VERBATIM: this is the next
 * line of a conversation, not a new task, so no project context is assembled
 * (that is tab-inject's job).
 */
import { NextRequest, NextResponse } from "next/server";
import { jsonOk, readJsonBody, z } from "@/lib/api/route-helpers";
import { AttachmentsField, stageAttachmentsForAgent } from "@/lib/composer-attachments";
import { materializeImages } from "@/lib/agent-attachments-fs";
import { enqueueInjectCommand } from "@/db/queries/pending-commands";
import { executionAccessErrorBody, resolveQueuedExecution } from "@/lib/execution-access";
import { isRuntimeAvailable } from "@/lib/runtime";
import { executor } from "@/lib/agent-execution";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { getApiUserId } from "@/lib/session";

const Body = z.object({
  tab: z.string().trim().min(1).max(120),
  text: z.string().max(4000),
  attachments: AttachmentsField,
  channel: z.enum(BUILDER_CHANNELS).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { tab, text, attachments, channel } = dataOrResp;
  const staged = stageAttachmentsForAgent(text, attachments);
  if (!staged.prompt.trim())
    return NextResponse.json({ error: "Nothing to send" }, { status: 400 });

  // This Loki owns the session's PTY (local runtime): the agent runs here.
  const wsHandle = isRuntimeAvailable() ? executor.get(workspaceIdFor(userId, tab)) : null;
  if (wsHandle && wsHandle.status !== "exited") {
    const prompt = materializeImages(staged.prompt, staged.images);
    executor.write(wsHandle.id, `\x1b[200~${prompt}\x1b[201~`);
    setTimeout(() => executor.write(wsHandle.id, "\r"), 250);
    return jsonOk({ mode: "pty" });
  }

  const execution = await resolveQueuedExecution(userId, { requestedChannel: channel ?? null });
  if (!execution.ok) {
    return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
  }
  const commandId = await enqueueInjectCommand(userId, {
    tab,
    ...(execution.channel ? { channel: execution.channel } : {}),
    prompt: staged.prompt,
    ...(staged.images.length > 0 ? { attachments: staged.images } : {}),
    promptLabel: text.slice(0, 40) || "Screenshot",
  });
  return jsonOk({ mode: "queued", commandId });
}
