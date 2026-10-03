/**
 * POST /api/control/transcript-frame
 *
 * The runner posts Claude Code conversation items for a tab it is streaming
 * (desktop/src/main/transcript-streamer.ts — only while someone watches). We
 * fan them to that (user, tab)'s viewers and keep the latest copy for the
 * next one to join (lib/sse-bus.ts).
 *
 * Auth: the runner's ck_* token, as peek-frame. Items can quote code and
 * command output — never logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { emitTranscriptFrame } from "@/lib/sse-bus";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";

const Item = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().max(200),
    at: z.string().max(40).nullable(),
    kind: z.literal("user"),
    text: z.string().max(20_000),
  }),
  z.object({
    id: z.string().max(200),
    at: z.string().max(40).nullable(),
    kind: z.literal("assistant"),
    text: z.string().max(20_000),
  }),
  z.object({
    id: z.string().max(200),
    at: z.string().max(40).nullable(),
    kind: z.literal("tool"),
    name: z.string().max(120),
    summary: z.string().max(200),
    status: z.enum(["running", "done", "error"]),
    result: z.string().max(1_500).nullable(),
  }),
]);

const Body = z.object({
  tab: z.string().trim().min(1).max(120),
  reset: z.boolean(),
  sessionId: z.string().max(120).nullable(),
  items: z.array(Item).max(100),
  channel: z.enum(BUILDER_CHANNELS).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { tab, reset, sessionId, items, channel } = dataOrResp;
  emitTranscriptFrame(userId, tab, { reset, sessionId, items, at: Date.now() }, channel);
  return NextResponse.json({ ok: true });
}
