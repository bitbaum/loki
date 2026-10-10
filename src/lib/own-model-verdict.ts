import type { ByokProbe } from "@bitbaum/ai-kit/byok-probe";

/**
 * What a probe's answer MEANS for the reader — four states, not two.
 *
 * ai-kit's probe answers "did the vendor accept the request", which folds two
 * different situations into one "no": a key the vendor does not know, and a
 * key it knows but will not bill. xAI answers the second with the same
 * non-2xx as the first and a sentence about credits. Loki shipped that as
 * "xAI didn't accept this key" with a disabled button, which is a wall — the
 * key was right, the account was empty, and the fix was one page away.
 *
 *   works        the key is good and billable — list its models, save
 *   unfunded     the vendor KNOWS the key but cannot bill it (no credits, a
 *                spending limit, a prepaid balance at zero) — save it, say so,
 *                link the vendor's billing page; the next turn works the
 *                moment the vendor's meter does
 *   refused      the vendor does not accept this key — do not save
 *   unreachable  we could not ask — try again; says nothing about the key
 *
 * Pure: a probe result in, a word out. No network, no vendor table.
 */
export type OwnModelVerdict = "works" | "unfunded" | "refused" | "unreachable";

const FUNDING =
  /credit|spending limit|spend limit|balance|billing|insufficient[_ ]quota|payment required|top[- ]?up|prepaid|exceeded your current quota/i;

export function ownModelVerdict(
  probe: Pick<ByokProbe, "ok" | "status" | "message">,
): OwnModelVerdict {
  if (probe.ok) return "works";
  if (probe.status === null) return "unreachable";
  // 401 is the vendor saying "who?" — never a funding problem, whatever the text.
  if (probe.status === 401) return "refused";
  if (probe.status === 402 || FUNDING.test(probe.message)) return "unfunded";
  return "refused";
}
