/**
 * A temporary chat: the conversation exists only while the person is in it.
 *
 * It is never listed (the rail, the start screen, the recap: every list
 * reads `conversations.ephemeral = false`), never fed to memory or
 * suggestions, and deleted the moment the person leaves it — a new chat, a
 * switch to another thread, a closed tab. The daily sweep deletes any left
 * over after a day, so a dead phone does not keep one.
 *
 * What the model is told, so it does not promise what the product cannot:
 * nothing. The chat still runs through the same providers; "temporary"
 * is about Loki's own records, and the menu item says exactly that.
 */

/** How long a left-over temporary chat survives before the sweep takes it. */
export const TEMPORARY_CHAT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const TEMPORARY_CHAT_LABEL = "Temporary chat";
export const TEMPORARY_CHAT_NOTE = "Not saved — gone when you leave";

/**
 * Did the person just leave the temporary thread? True when the active
 * thread was the temporary one and is no longer — whatever it became.
 */
export function leavesTemporary(
  previousActiveId: string | null,
  activeId: string | null,
  temporaryId: string | null,
): boolean {
  return temporaryId !== null && previousActiveId === temporaryId && activeId !== temporaryId;
}
