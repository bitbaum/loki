/**
 * Name a thread from what it is about — the one implementation behind
 * POST /api/conversations/[id]/title and the server-side naming after a
 * thread's first answer.
 *
 * Idempotent and cheap to call again: a thread whose title a person chose, a
 * channel thread Loki named itself, and a thread with no answer yet keep their
 * current title with no model call. Otherwise one short call to the fast
 * model; a failed or unusable reply keeps the title it had, because a
 * slightly worse title is never worth an error.
 *
 * Never bumps the thread's recency: being named is not activity.
 */
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

export type NameThreadResult =
  | { found: false }
  | {
      found: true;
      title: string;
      changed: boolean;
      /** Still Loki's to name; only the model's reply was unusable. */
      retry?: boolean;
    };

export async function nameThread(
  userId: string,
  conversationId: string,
): Promise<NameThreadResult> {
  const found = await getConversationWithMessages(userId, conversationId);
  if (!found) return { found: false };
  const { conversation, messages } = found;
  const unchanged = { found: true as const, title: conversation.title, changed: false };

  if (conversation.channel) return unchanged;
  const question = messages.find((m) => m.role === "user")?.content ?? "";
  const answer = messages.find((m) => m.role === "assistant" && m.content.trim())?.content ?? "";
  if (!question.trim() || !answer) return unchanged;
  if (
    !isAutoTitle(conversation.title, deriveConversationTitle(question), DEFAULT_CONVERSATION_TITLE)
  ) {
    return unchanged;
  }

  let title: string | null = null;
  try {
    const raw = await callGroqText(
      buildThreadTitlePrompt({ question, answer, project: conversation.projectKeys[0] ?? null }),
      {
        feature: "chat-thread-title",
        systemPrompt: THREAD_TITLE_SYSTEM_PROMPT,
        model: GROQ_FAST_MODEL,
        // The fast model REASONS before it answers, and that reasoning is
        // drawn from this same budget. At 40 the title was cut mid-thought on
        // the live site — a thread named "Bring" (from "Bring the runner
        // online…") or nothing at all. The title is still capped by the parser.
        maxTokens: 300,
        temperature: 0.3,
        timeoutMs: 8_000,
      },
    );
    title = parseThreadTitle(raw, conversation.projectKeys[0] ?? null);
  } catch {
    title = null;
  }
  if (!title) return { ...unchanged, retry: true };
  if (title === conversation.title) return unchanged;

  await updateConversationTitle(userId, conversation.id, title, { touch: false });
  return { found: true, title, changed: true };
}

/** How long to wait before asking again when the model's reply was unusable. */
const RETRY_DELAYS_MS = [10_000, 30_000];

/**
 * Name a thread once its first answer is saved, from the server.
 *
 * The browser used to be the only caller, three seconds after the answer —
 * so a person who read the answer and locked their phone, or closed the tab,
 * left the thread named by its opening line forever (four of the test
 * account's threads on 2026-10-17). The browser still asks; the second ask
 * finds the thread named and costs nothing.
 */
export function nameThreadSoon(userId: string, conversationId: string): void {
  const attempt = (n: number) => {
    nameThread(userId, conversationId)
      .then((r) => {
        if (r.found && r.retry && n < RETRY_DELAYS_MS.length) {
          setTimeout(() => attempt(n + 1), RETRY_DELAYS_MS[n]).unref?.();
        }
      })
      .catch(() => {
        /* the thread keeps its opening line; the browser may still name it */
      });
  };
  attempt(0);
}
