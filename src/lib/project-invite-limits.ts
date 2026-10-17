/**
 * How long project invitations last — the numbers alone, with no Node
 * imports, so the owner's invite panel (a client component) can say them
 * without pulling node:crypto into the browser bundle. lib/project-invites
 * holds the rules and reads these.
 */

/** An invite addressed to one email. */
export const PROJECT_INVITE_TTL_DAYS = 14;

/**
 * An open link — one with no email on it — is spent sooner: anyone holding it
 * can take the seat, so it should not lie around in a chat for two weeks.
 */
export const OPEN_INVITE_TTL_DAYS = 7;
