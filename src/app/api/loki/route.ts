import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { askLoki } from "@/lib/loki-core";
import { getProjectContext } from "@/db/queries/project-context";
import { isSiteOperator } from "@/db/queries/users";
import { enqueueProposalFromMessage } from "@/lib/actions/enqueue-proposal";

const AskLokiBody = z.object({
  message: z.string().trim().min(1, "message is required"),
  // When set, scope the conversation to a project: load its brief + goals as
  // context so Loki reasons about it, and keep a per-project thread.
  projectKey: z.string().trim().max(120).optional(),
  // Include the (token-heavy) full context this turn — the client sends true on
  // the first message of a project thread, false after (the agent's session
  // memory carries it forward).
  includeContext: z.boolean().default(false),
  // Text the user can actually see, read from the rendered page. Grounds
  // answers about "this" in what is on screen instead of guessing from a route.
  // CLAMPED, not rejected: the client reads the page unconditionally, so a
  // long page used to turn the whole request into a 400 ("Loki did not
  // answer") — the assistant broke on exactly the pages with the most on them.
  pageContext: z
    .string()
    .trim()
    .transform((s) => s.slice(0, PAGE_CONTEXT_MAX_CHARS))
    .optional(),
  // The panel's own transcript, oldest first, so a follow-up ("and the second
  // one?") has something to follow. The floating assistant keeps its turns in
  // client state only, so this is the only way they reach the model.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(12)
    .optional(),
  // The caller is a chat that shows suggested replies under the answer (the
  // floating assistant). Off for one-shot callers such as a prompt run, where
  // a row of buttons would have nowhere to send.
  replies: z.boolean().default(false),
});

const PAGE_CONTEXT_MAX_CHARS = 2000;

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, AskLokiBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  // "Ask Loki" = the user's PERSONAL Loki conversation. When LOKI_PERSONAL_SESSION_KEY
  // is set (single-tenant box: the operator's `agent:main:direct:<id>`), the modal joins
  // the SAME session as Telegram/WhatsApp → one continuous conversation across surfaces.
  // Unset (multi-tenant default) → a stable per-user web thread. The Loki *page* keeps
  // its own per-conversation threads regardless (same agent + memory).
  // userId also resolves the caller's writing-voice preference.
  //
  // The personal key is the OPERATOR's session — their Telegram/WhatsApp thread
  // — so it applies to the operator's account only. It used to apply to every
  // signed-in user, which on a box with open sign-up put strangers' questions
  // (and the answers drawn from the operator's memory) into the operator's
  // private conversation. Everyone else keeps their own per-user thread.
  let message = dataOrResp.message;
  const personalKey = process.env.LOKI_PERSONAL_SESSION_KEY?.trim();
  let sessionKey =
    personalKey && (await isSiteOperator(userId).catch(() => false))
      ? personalKey
      : `agent:main:web:ask:${userId}`;

  // Project-scoped discussion: a per-project thread, with the project's brief +
  // goals prefaced so Loki reasons as a partner on THIS project (not the generic
  // assistant). Context is prefaced only on the first turn; the shared agent's
  // per-session memory carries it forward.
  if (dataOrResp.projectKey) {
    sessionKey = `agent:main:web:project:${dataOrResp.projectKey.toLowerCase()}:${userId}`;
    if (dataOrResp.includeContext) {
      const ctx = await getProjectContext(userId, dataOrResp.projectKey).catch(() => null);
      if (ctx) {
        message = `You are Loki, acting as a reasoning partner on the owner's project "${dataOrResp.projectKey}". Here is its current context — use it to give specific, grounded answers:\n\n${ctx}\n\n---\n\nThe owner says:\n${dataOrResp.message}`;
      }
    }
  }

  // Ground the turn in what the operator is looking at. The closing rule
  // matters as much as the excerpt: without it the model answers confidently
  // about parts of the page that were never in the excerpt.
  if (dataOrResp.pageContext) {
    message = `Visible on the operator's screen right now:\n\n"""\n${dataOrResp.pageContext}\n"""\n\nUse this only when it is relevant. If they ask about something on the page that is not in the text above, say you cannot see it rather than guessing.\n\n---\n\n${message}`;
  }

  // Answer the turn AND, in parallel, detect whether the operator asked Loki to
  // DO something external (message someone, email, book an event, make a
  // commitment). Extraction runs on the RAW user message — the intent, not the
  // context-wrapped prompt — and is fully best-effort: a null/throw just means
  // "nothing to queue this turn" and never blocks the reply. This is the queue's
  // producer; the operator still approves every draft before it executes.
  const [{ status, body }, queued] = await Promise.all([
    askLoki(message, {
      sessionKey,
      userId,
      history: dataOrResp.history,
      replies: dataOrResp.replies,
    }),
    enqueueProposalFromMessage(userId, dataOrResp.message, new Date().toISOString()).catch(
      () => null,
    ),
  ]);

  if (queued) body.queuedAction = queued;
  return NextResponse.json(body, { status });
}
