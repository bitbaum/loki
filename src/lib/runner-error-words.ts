/**
 * The runner's failure sentence without the runner's own bookkeeping.
 *
 * A failed dispatch reads "launched claude (pty) + injected, but Loki could
 * not verify generation. claude's container failed to start: … Check the
 * builder (sealed-builds containers / journal)." The first clause is how the
 * runner delivered the prompt and the last is a note to an operator; the
 * owner met both on Home on a phone (2026-11-11). What is left is the cause.
 * The stored error is unchanged: other code classifies failures by its words.
 */
const PREAMBLE =
  /^(?:launched \S+ \(pty\) \+ injected|injected to running \S+ \(pty\)),? but Loki could not verify generation\.?\s*/i;
const OPERATOR_NOTE = /\s*Check the builder \([^)]*\)\.?\s*$/i;

export function runnerErrorForPerson(error: string): string {
  const cause = error.replace(PREAMBLE, "").replace(OPERATOR_NOTE, "").trim();
  if (!cause) return "The agent opened but never answered.";
  return cause.charAt(0).toUpperCase() + cause.slice(1);
}
