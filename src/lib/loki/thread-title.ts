/**
 * What a thread is about, in a few words — written by Loki once the first
 * answer lands, so the rail reads as a list of topics instead of a list of
 * opening lines.
 *
 * A thread used to be titled with the first sixty characters typed into it.
 * Fifteen threads that each began "move forward on loki" were fifteen rows
 * that read identically, and the rail had to collapse them into one row with
 * a count (conversation-groups.ts) to stay usable. The opening line says how
 * a conversation STARTED; the title has to say what it is ABOUT, and only the
 * exchange knows that.
 *
 * Two rules keep this honest:
 * 1. A person's own title is never overwritten. Only a title that is still
 *    the placeholder, or still exactly the derived opening line, is Loki's to
 *    replace (`isAutoTitle`). A rename is a decision; a derivation is not.
 * 2. A bad model reply changes nothing. `parseThreadTitle` returns null for
 *    anything that is not a short, plain title, and the caller keeps what
 *    the thread already had.
 *
 * Pure: prompt in, title out. The model call lives in the route.
 */

/** A title is read at a glance in a 260px rail: about six words. */
export const THREAD_TITLE_MAX_CHARS = 48;
/** What of the exchange the model sees — enough to name it, cheap to send. */
export const THREAD_TITLE_INPUT_CHARS = 1500;

export const THREAD_TITLE_SYSTEM_PROMPT = [
  "You name a chat conversation for a list of conversations.",
  "Reply with the title only: 2 to 6 words, in the user's language, no quotes, no trailing punctuation.",
  "Name the subject and the outcome sought (e.g. 'Checkout bug on kivvi', 'Pricing page copy', 'Plan for the Zurich move').",
  "If a project is named, start with it. Never start with 'Chat about', 'Question about' or 'Conversation'.",
].join(" ");

export function buildThreadTitlePrompt(input: {
  question: string;
  answer: string;
  project?: string | null;
}): string {
  const clip = (s: string) => s.trim().slice(0, THREAD_TITLE_INPUT_CHARS);
  const scope = input.project ? `Project: ${input.project}\n\n` : "";
  return `${scope}User wrote:\n${clip(input.question)}\n\nAssistant answered:\n${clip(input.answer)}`;
}

/** Words a model reaches for that make a title worse, not better. */
const FILLER_PREFIX =
  /^(?:title|chat|conversation|discussion|question)s?\s*(?:about|on|re|:|-|–|—)\s*/i;

/**
 * Whatever the model returned → a clean title, or null to keep the old one.
 * Takes the first non-empty line, strips quotes, markdown and a "Title:"
 * label, drops trailing punctuation, and refuses anything still too long to
 * be a title rather than cutting it mid-word.
 */
export function parseThreadTitle(raw: string): string | null {
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const title = line
    .replace(/^[*_`#>\s]+|[*_`\s]+$/g, "")
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .replace(FILLER_PREFIX, "")
    .replace(/[.!?:;,\s]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length < 2 || title.length > THREAD_TITLE_MAX_CHARS) return null;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * May Loki replace this title? Only while it is the placeholder or exactly
 * the opening line it was derived from — anything else a person typed.
 */
export function isAutoTitle(
  title: string,
  derivedFromFirstMessage: string | null,
  placeholder: string,
): boolean {
  const t = title.trim();
  if (t === "" || t === placeholder) return true;
  return derivedFromFirstMessage !== null && t === derivedFromFirstMessage.trim();
}
