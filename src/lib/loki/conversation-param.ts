import { isValidUuid } from "@/lib/utils";

/** `?c=` → the conversation to reopen, or null for anything that is not an id. */
export function conversationIdFromParam(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v && isValidUuid(v) ? v : null;
}

/**
 * A project's thread is "home" for this long after its last message. Past
 * it, the conversation is history and a link should start fresh.
 */
export const HOME_THREAD_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Which thread a link into the chat should open.
 *
 * `?c=` wins — it names a thread. Otherwise a link that names a project
 * (`/loki?project=kivvi`: "Ask Loki" from a project, the terminal, Control)
 * opens that project's most recent thread, if it was active in the last two
 * weeks. Every such link used to land on an empty start screen, so the next
 * message minted another thread: that is how fifteen "move forward on loki"
 * threads came to exist. "New chat" stays one tap away for a new topic.
 *
 * A link that also carries `?q=` (a prefilled ask, a site hand-off) is left
 * on the start screen: it is the beginning of something, by construction.
 *
 * Pure: the list is the one the page already prefetched, newest first.
 */
export function initialThreadId(input: {
  c: string | null | undefined;
  project: string | null | undefined;
  q: string | null | undefined;
  conversations: { id: string; projectKeys: string[]; updatedAt: string }[] | undefined;
  now?: number;
}): string | null {
  const named = conversationIdFromParam(input.c);
  if (named) return named;
  const project = input.project?.trim().toLowerCase();
  if (!project || input.q?.trim() || !input.conversations) return null;
  const now = input.now ?? Date.now();
  const home = input.conversations
    .filter((c) => c.projectKeys.some((k) => k.toLowerCase() === project))
    .map((c) => ({ id: c.id, at: Date.parse(c.updatedAt) }))
    .filter((c) => Number.isFinite(c.at) && now - c.at <= HOME_THREAD_MAX_AGE_MS)
    .sort((a, b) => b.at - a.at)[0];
  return home?.id ?? null;
}
