/**
 * Suggested replies on a stored Loki answer.
 *
 * The model writes them in the same turn as the answer (chatkit's
 * REPLIES_INSTRUCTION); the core takes them out of the text before anything
 * is stored, and the messages route keeps them in `meta.replies`. So the
 * stored `content` — what is copied, spoken, saved to memory, titled,
 * previewed and fed back as history — never carries the block.
 *
 * Defensive like citationsFrom: meta is opaque and older turns have none.
 */
export function readReplies(meta: Record<string, unknown> | null | undefined): string[] {
  const raw = meta?.replies;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string" && r.trim().length > 0);
}
