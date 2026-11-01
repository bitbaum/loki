/**
 * POST /api/orangecat/ask — one of the person's OrangeCat bots asks Loki a
 * question, as the person.
 *
 * This is the first CONNECTOR a bot reaches (OrangeCat ADR-0013 D6): the bot
 * does not know how to build or deploy anything, it asks the agent that does.
 * Loki answers from the person's own projects, dispatches, pages and notes,
 * because the turn runs as the Loki user linked to the OrangeCat actor and
 * never as anyone else.
 *
 * Read-only on purpose. `readOnly` strips the tool loop of its propose tools
 * and skips the gateway fallback, so a question relayed by a bot cannot
 * approve, dispatch or spend; the person does those in Loki, or through the
 * `send_task_to_loki` door, which is the one that is confirmed every time.
 *
 * Lives under /api/orangecat/ because that prefix IS the auth decision (see
 * ../task/route.ts): same rail, same secret, same fail-closed posture.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { logDebug } from "@/db/queries/debug-logs";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { askLoki } from "@/lib/loki-core";

/** A question, not a document: the MCP door has the same ceiling. */
export const ASK_MAX_CHARS = 4000;

const Body = z.object({
  actorId: z.string().uuid(),
  question: z.string().trim().min(1).max(ASK_MAX_CHARS),
  /** Which bot asked — its thread keeps its own Loki session. */
  threadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "threadId: letters, digits, - and _ only (max 64)")
    .optional(),
  /** Where on OrangeCat this was asked — for attribution, not routing. */
  originUrl: z.string().trim().url().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "ask rail not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { actorId, question, threadId, originUrl } = dataOrResp;

  const user = await getUserByOrangeCatActorId(actorId);
  if (!user) {
    return NextResponse.json(
      {
        error: "no linked Loki account",
        detail:
          "This OrangeCat identity is not linked to a Loki account yet. Sign in to Loki with the same OrangeCat identity once, then try again.",
      },
      { status: 409 },
    );
  }

  const sessionKey = `agent:main:web:bot:${user.id}${threadId ? `:${threadId}` : ""}`;
  const { status, body } = await askLoki(question, { userId: user.id, sessionKey, readOnly: true });

  await logDebug({
    source: "orangecat/ask",
    level: status === 200 ? "info" : "warn",
    message: status === 200 ? "a bot asked Loki" : `a bot asked Loki; Loki answered ${status}`,
    meta: { actorId, userId: user.id, originUrl, questionLength: question.length, threadId },
  }).catch(() => {});

  if (status !== 200 || typeof body.text !== "string") {
    // Budget refusals (429) and outages carry a sentence meant for a person.
    return NextResponse.json(
      { error: typeof body.error === "string" ? body.error : "Loki did not answer." },
      { status: status === 200 ? 502 : status },
    );
  }
  return NextResponse.json({ text: body.text }, { status: 200 });
}
