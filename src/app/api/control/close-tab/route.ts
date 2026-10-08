import { NextRequest, NextResponse } from "next/server";
import { enqueueTabCommand } from "@/db/queries/pending-commands";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { executionAccessErrorBody, resolveQueuedExecution } from "@/lib/execution-access";

const CloseTabBody = z.object({
  tab: z.string().trim().min(1).max(120),
  // The builder the operator is looking at. Without it the close was always
  // routed to the cloud builder, so closing a tab on "This computer" either
  // did nothing or hit a different machine's session of the same name.
  channel: z.enum(["cloud", "local"]).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dataOrResp = await readJsonBody(req, CloseTabBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const execution = await resolveQueuedExecution(userId, {
    defaultChannel: "cloud",
    requestedChannel: dataOrResp.channel ?? null,
  });
  if (!execution.ok) {
    return NextResponse.json(executionAccessErrorBody(execution), { status: execution.status });
  }
  const commandId = await enqueueTabCommand(userId, "close_tab", {
    tab: dataOrResp.tab,
    ...(execution.channel ? { channel: execution.channel } : {}),
  });
  return NextResponse.json({
    ok: true,
    queued: true,
    commandId,
    runnerConnected: execution.runnerConnected,
  });
}
