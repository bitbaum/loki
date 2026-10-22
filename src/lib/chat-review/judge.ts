import { CHAT_REVIEW_INSTRUCTION, reviewPrompt, type ChatTranscript } from "@bitbaum/chatkit";

/**
 * The judge's whole input for one conversation: the system instruction
 * chatkit wrote, and the scope + conversation as `reviewPrompt` lays them
 * out. Nothing of Loki's is added, so every product in the fleet is judged
 * by the same words. Pure; pinned by scripts/test/chat-review.ts.
 *
 * Who the judge IS: not a model call this server makes. No box timer may
 * spend the shared free AI tier (scripts/test/no-free-background-ai.ts), so
 * the night hands this input to an agent run on the product's own Loki
 * project (prompt.ts, dispatch.ts) — the same way AI review reads a page.
 */
export function judgeInput(
  scope: string,
  transcript: ChatTranscript,
): { system: string; user: string } {
  return { system: CHAT_REVIEW_INSTRUCTION, user: reviewPrompt(scope, transcript) };
}
