/**
 * Suggested next questions under an answer — the "↳ Make it longer" rows the
 * reference chat shows. One cheap call to the fast model after a turn lands;
 * nothing here is stored, and nothing is sent until the person taps one.
 *
 * The FIRST suggestion is the recommended next step, the rest alternatives —
 * the owner's standing ask is that every answer ends with "what do I do next",
 * and FollowUps marks the first row as the recommendation.
 *
 * Pure (prompt in, list out), so the part that breaks — reading whatever the
 * model actually returned — is pinned by scripts/test/loki-follow-ups.ts.
 */

/** Three is what fits under an answer on a phone without becoming a menu. */
export const FOLLOW_UPS_MAX = 3;
/** A suggestion is a tap target, not a paragraph. */
export const FOLLOW_UP_MAX_CHARS = 90;
/** What of the exchange the model sees: enough to be specific, cheap to send. */
export const FOLLOW_UP_INPUT_CHARS = 3000;

export const FOLLOW_UP_SYSTEM_PROMPT = [
  "You suggest what the user might want to ask next in a chat.",
  `Reply with exactly ${FOLLOW_UPS_MAX} short follow-up requests, one per line, nothing else.`,
  "Write each as the user would type it (first person or imperative), in the user's language,",
  `under ${FOLLOW_UP_MAX_CHARS - 20} characters, specific to this exchange. No numbering, no quotes.`,
  "Put first the one step you would recommend they take next; the others are alternatives.",
].join(" ");

export function buildFollowUpPrompt(question: string, answer: string): string {
  const clip = (s: string) => s.trim().slice(0, FOLLOW_UP_INPUT_CHARS);
  return `User asked:\n${clip(question)}\n\nAssistant answered:\n${clip(answer)}`;
}

/**
 * Whatever the model returned → at most FOLLOW_UPS_MAX clean suggestions.
 * Tolerates numbering, bullets, quotes, a JSON array, and a preamble line
 * ("Here are some follow-ups:"); drops duplicates and anything too long to be
 * a tap target rather than cutting it mid-sentence.
 */
export function parseFollowUps(raw: string): string[] {
  let lines: string[];
  const trimmed = raw.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    lines = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    lines = trimmed.split("\n");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const text = line
      .trim()
      .replace(/^(?:(?:[-*•↳]|\d+[.)])\s*)+/, "")
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    if (!text || text.length > FOLLOW_UP_MAX_CHARS) continue;
    if (/:$/.test(text)) continue; // a preamble, not a suggestion
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === FOLLOW_UPS_MAX) break;
  }
  return out;
}
