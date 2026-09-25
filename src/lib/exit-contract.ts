/**
 * The exit contract's shape — heading and matcher — with NO Node imports.
 *
 * Kept apart from agent-config.ts (which builds the full contract and imports
 * `fs`) because client code reads it too: the Activity feed strips the
 * contract from a dispatch before showing what the operator asked for. When
 * activity-status.ts imported the matcher from agent-config, `fs` was pulled
 * into the browser bundle and the production build failed — which `verify`
 * cannot see, because CI does not run `next build` (2026-09-25, loki#900:
 * four deploys refused before anything shipped).
 */

export const EXIT_CONTRACT_HEADING = "## Exit contract (operator requirement)";

/**
 * Matches the exit contract at the end of a dispatch. The contract is always
 * the LAST section and runs to the end of the message — every builder appends
 * it last — so this consumes from its heading to the end.
 */
export const EXIT_CONTRACT_PATTERN = /\n?^##[ \t]*Exit contract\b[\s\S]*$/im;
