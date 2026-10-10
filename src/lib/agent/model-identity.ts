/**
 * One line in Loki's system prompt saying what it is running on, so "which
 * model are you" is answered from the prompt in one sentence — not with a
 * tool round and a referral to Settings.
 *
 * Owner, 2026-10-10, on a phone: asked which model was in use, waited 25
 * seconds, and was told to check the API key in Settings. Loki knew the
 * answer before the turn started; it was just not in front of the model.
 *
 * Honest about what is known BEFORE the call: on the owner's own keys the
 * first link is what Loki thinks with (the label names it, and the vendors
 * after it are fallbacks); on the shared chain a pin names where the chain
 * starts, and without a pin the chain starts at its first usable link, which
 * the turn's footer reports once it has answered.
 */
export function modelIdentityLine(
  own: { label: string } | null | undefined,
  pinned: string | null | undefined,
): string {
  if (own) {
    return `\n\nYou are running on the operator's own key: ${own.label}. If asked which model you are or which key is in use, say exactly that, in one sentence — their own Settings → AI chooses it, and the answer's footer names the model that actually replied.`;
  }
  const start = pinned?.trim()
    ? `the model they pinned in the composer, ${pinned.trim()}`
    : "Loki's shared chain of free models, starting at its first available link";
  return `\n\nYou are running on ${start}. If asked which model you are, say so in one sentence and add that the answer's footer names the model that actually replied; a key of their own in Settings → AI would replace the shared chain for their chats.`;
}
