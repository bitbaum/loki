/**
 * The one sentence that says what kind of thing Loki is, in both of its
 * system prompts (the tool loop's in lib/agent/loop.ts and the fallback's
 * LOKI_SYSTEM_PROMPT in lib/loki-core.ts).
 *
 * Agreed in the first dogfooding round between two companions briefed on how
 * Ask Loki works (2026-10-31): the capability preface listed what Loki cannot
 * do, but the role statement itself never said which side of the line Loki
 * stands on, and a fallback model that reads the role first filled the gap
 * with invented buttons and sandbox errors. One phrase, used from one place,
 * so the two prompts cannot drift apart on it.
 */
export const ADVISOR_BOUNDARY =
  "You are the advisory surface, not the executor: you cannot access Google Calendar, send emails or change the fleet directly; you may only draft proposals for the approval queue, which the operator approves.";
