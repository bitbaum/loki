import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiActor } from "@/lib/session";
import { enqueuePendingCommand } from "@/db/queries/pending-commands";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { terminalHref } from "@/lib/dispatch-card";
import { mayPeekTab } from "@/lib/peek-access";

const PeekTabBody = z.object({
  tab: z.string().trim().min(1).max(120),
  /** Which builder answers. Absent: whichever of the caller's builders claims it. */
  channel: z.enum(BUILDER_CHANNELS).optional(),
});

/**
 * Ask a builder for one capture of a session's screen. Session or `ck_`
 * token. The answer is read at `resultUrl`; `openUrl` is where a person
 * opens the same session in Loki, on any device they are signed in on.
 */
export async function POST(req: NextRequest) {
  const actor = await getApiActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, PeekTabBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { tab, channel } = dataOrResp;
  if (!mayPeekTab(tab, actor.via)) {
    return NextResponse.json(
      { error: "A shell's screen is read in a signed-in browser, not with a token." },
      { status: 403 },
    );
  }

  const peekId = await enqueuePendingCommand({
    userId: actor.userId,
    type: "peek_tab",
    payload: { tab, ...(channel ? { channel } : {}) },
  });

  return NextResponse.json({
    ok: true,
    peekId,
    resultUrl: `/api/control/peek-tab/${peekId}`,
    openUrl: terminalHref(tab, channel ?? null),
  });
}
