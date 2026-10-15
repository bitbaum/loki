import { type NextRequest, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  getConversationWithMessages,
  updateConversationTitle,
} from "@/db/queries/conversations";
import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import {
  buildThreadTitlePrompt,
  isAutoTitle,
  parseThreadTitle,
  THREAD_TITLE_SYSTEM_PROMPT,
} from "@/lib/loki/thread-title";

/**
 * POST /api/conversations/[id]/title — name the thread from what it is about.
 *
 * Idempotent and cheap to call again: a thread whose title a person chose, a
 * channel thread Loki named itself, and a thread with no answer yet are all
 * answered with their current title and no model call. Otherwise one short
 * call to the fast model; a failed or unusable reply keeps the title it had
 * (`changed: false`), because a slightly worse title is never worth an error.
 *
 * Never bumps the thread's recency: being named is not activity.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const found = await getConversationWithMessages(userId, idOrResp);
  if (!found) return jsonError("Not found", 404);
  const { conversation, messages } = found;
  const unchanged = () => jsonOk({ title: conversation.title, changed: false });

  if (conversation.channel) return unchanged();
  const question = messages.find((m) => m.role === "user")?.content ?? "";
  const answer = messages.find((m) => m.role === "assistant" && m.content.trim())?.content ?? "";
  if (!question.trim() || !answer) return unchanged();
  if (
    !isAutoTitle(conversation.title, deriveConversationTitle(question), DEFAULT_CONVERSATION_TITLE)
  ) {
    return unchanged();
  }

  // `retry: true` tells the client the thread is still Loki's to name and
  // only the model was not available — it asks again shortly. Found in
  // production: the first ask lands right after the answer, while that turn
  // has just spent the fast model's minute window, and fails.
  let title: string | null = null;
  try {
    const raw = await callGroqText(
      buildThreadTitlePrompt({ question, answer, project: conversation.projectKeys[0] ?? null }),
      {
        feature: "chat-thread-title",
        systemPrompt: THREAD_TITLE_SYSTEM_PROMPT,
        model: GROQ_FAST_MODEL,
        maxTokens: 40,
        temperature: 0.3,
        timeoutMs: 8_000,
      },
    );
    title = parseThreadTitle(raw);
  } catch {
    title = null;
  }
  if (!title) return jsonOk({ title: conversation.title, changed: false, retry: true });
  if (title === conversation.title) return unchanged();

  await updateConversationTitle(userId, conversation.id, title, { touch: false });
  return jsonOk({ title, changed: true });
}
