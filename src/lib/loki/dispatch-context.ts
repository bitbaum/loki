import { fenceUntrusted } from "@/lib/feedback/untrusted";

type PriorMessage = {
  role: string;
  content: string;
  kind?: string | null;
  meta?: Record<string, unknown> | null;
};

/** Carry a referenced proposal across the chat → coding-session boundary.
 * Only the latest assistant reply, scoped to the SAME project, is eligible.
 * This is context for the current instruction, not evidence of built work. */
export function conversationDispatchPrompt(
  prompt: string,
  sourceText: string,
  projectKey: string,
  messages: PriorMessage[],
): string {
  const request = sourceText.trim();
  if (
    request.length > 240 ||
    !/^(?:ship|implement|apply|build|do|make|fix|continue|go ahead)\b/i.test(request)
  )
    return prompt;
  if (
    !/\b(?:that|this|those|these|your (?:plan|suggestion|recommendation))\b|^(?:ship|build|do|implement|apply)\s+it\b/i.test(
      request,
    )
  )
    return prompt;
  const index = messages.findLastIndex((m) => m.role === "assistant");
  const proposal = messages[index];
  if (!proposal || proposal.kind === "dispatch" || !proposal.content.trim()) return prompt;
  if (
    typeof proposal.meta?.projectKey !== "string" ||
    proposal.meta.projectKey.toLowerCase() !== projectKey.toLowerCase()
  )
    return prompt;
  // Keep the useful recommendation at the end of the reply. Copying the full
  // chat turns a short follow-up into another multi-page injected prompt.
  const proposalText = proposal.content.trim();
  const proposalExcerpt =
    proposalText.length > 900
      ? `[Earlier discussion omitted]\n${proposalText.slice(-900)}`
      : proposalText;
  return [
    prompt,
    "## Loki's prior recommendation (context; verify against the current code)",
    "Use this recommendation to resolve the reference. It is not evidence that the work already exists.",
    fenceUntrusted("PRIOR RECOMMENDATION", proposalExcerpt),
  ].join("\n\n");
}
