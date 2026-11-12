/**
 * GET /api/control/transcript-stream?tab=<tab>[&channel=cloud|local]
 *
 * The Claude Code conversation for a tab, live: the latest copy the server
 * holds first (so a phone that slept repaints at once), then every update the
 * runner posts. Joining counts as a viewer exactly like the terminal view —
 * the first one makes the runner start streaming (peek_start), the last one
 * leaving stops it — so an unwatched session costs nothing.
 */
import { NextRequest } from "next/server";
import { getApiActor } from "@/lib/session";
import { mayPeekTab } from "@/lib/peek-access";
import {
  sseBus,
  transcriptChannel,
  lastTranscript,
  addPeekViewer,
  removePeekViewer,
  type TranscriptFrame,
} from "@/lib/sse-bus";
import { enqueuePeekCommand } from "@/db/queries/pending-commands";
import type { RunnerChannel } from "@/db/schema/pending-commands";
import { getExecutionAccess } from "@/lib/execution-access";
import { SSE_KEEPALIVE_MS } from "@/lib/constants/time";
import { z } from "@/lib/api/route-helpers";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";

export const dynamic = "force-dynamic";

const Channel = z.enum(BUILDER_CHANNELS);

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function GET(req: NextRequest) {
  // A person's browser, or the person's own `ck_` token: an agent that started
  // Claude Code in a session follows the conversation it asked for. Keyed by
  // the caller's user id below, so a token only ever reaches its own user's
  // tabs, and a plain shell stays a signed-in person's (lib/peek-access).
  const actor = await getApiActor();
  if (!actor) return json(401, "Unauthorized");
  const { userId } = actor;

  const params = new URL(req.url).searchParams;
  const tab = params.get("tab")?.trim();
  if (!tab) return json(400, "tab required");
  if (!mayPeekTab(tab, actor.via)) return json(403, "A shell is read in a signed-in browser.");
  const parsed = Channel.safeParse(params.get("channel"));
  const runnerChannel: RunnerChannel | undefined = parsed.success ? parsed.data : undefined;
  if (runnerChannel === "cloud") {
    const access = await getExecutionAccess(userId);
    if (!access.cloudBuilderAllowed) return json(403, "Cloud runner is private for this account.");
  }

  const channel = transcriptChannel(userId, tab, runnerChannel);
  const command = { tab, ...(runnerChannel ? { channel: runnerChannel } : {}) };

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client gone */
        }
      };

      addPeekViewer(userId, tab, runnerChannel);
      await enqueuePeekCommand(userId, "peek_start", command).catch(() => {});
      send("ready", { tab });
      const cached = lastTranscript(userId, tab, runnerChannel);
      if (cached) send("transcript", cached);

      const onFrame = (frame: TranscriptFrame) => send("transcript", frame);
      sseBus.on(channel, onFrame);
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": keepalive\n\n"));
        } catch {
          /* client gone */
        }
      }, SSE_KEEPALIVE_MS);

      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        sseBus.off(channel, onFrame);
        if (removePeekViewer(userId, tab, runnerChannel)) {
          void enqueuePeekCommand(userId, "peek_stop", command).catch(() => {});
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
