/**
 * The marker between a project-scoped chat prompt's context block and the
 * person's own words (lib/loki/chat-context.ts builds the prompt).
 *
 * Pure, so anything that must judge what the PERSON asked — not the context
 * Loki wrapped around it — can read their words without a database.
 */
export const USER_MESSAGE_MARKER = "[User message]";

/**
 * The person's own words in a chat prompt: everything after the last marker,
 * or the whole prompt when it carries no project scope.
 *
 * Found on the live site (2026-10-17): every chat on a one-project account is
 * scoped, so "What year was the Eiffel Tower built?" reached the classifier as
 * "[Scoped to project: second-cafe] …project details… [User message] What
 * year…" — and the word "project" in the wrapper made every question one
 * about the person's projects.
 */
export function userWords(prompt: string): string {
  const at = prompt.lastIndexOf(`${USER_MESSAGE_MARKER}\n`);
  return at === -1 ? prompt : prompt.slice(at + USER_MESSAGE_MARKER.length + 1).trim();
}
