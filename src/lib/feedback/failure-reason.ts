/**
 * One plain sentence for why a feedback run failed, read from the run's raw
 * error — the line a person sees under a red "Failed" badge.
 *
 * It used to be the single word "Retry", printed as text directly above a
 * button that also said Retry (2026-09-28, a Petvity report): the owner saw
 * a failure, no reason, and the same instruction twice. The raw error stays
 * behind "Technical details"; this is the translation of it. Each sentence
 * ends in the next move, and only names Retry where repeating could help.
 */

const has = (text: string, ...needles: (string | RegExp)[]) =>
  needles.some((n) => (typeof n === "string" ? text.includes(n) : n.test(text)));

export function explainRunFailure(error: string | null | undefined): string {
  const text = (error ?? "").toLowerCase();
  if (!text.trim()) return "It stopped without saying why — Retry, or switch provider.";
  if (
    has(
      text,
      "usage limit",
      "quota",
      "rate limit",
      "rate_limit",
      "too many requests",
      "credit balance",
      "insufficient_quota",
      /\b429\b/,
    )
  )
    return "The agent ran out of quota — switch provider, or Retry once it resets.";
  if (has(text, "dispatch failed before the prompt reached the agent"))
    return "It never reached an agent — Retry, or check the builder is online.";
  if (
    has(
      text,
      "could not read from remote",
      "authentication failed",
      "permission denied",
      "repository not found",
      "unauthorized",
      /\b40[13]\b/,
    )
  )
    return "The agent could not open the repository — check the project's Git connection, then Retry.";
  if (has(text, "no running agent", "tab not found", "no session named"))
    return "No agent session was running for this project — Retry starts one.";
  if (has(text, "timed out", "timeout", "exceeded maximum duration", "hang"))
    return "It ran too long and was stopped — Retry, ideally with a narrower instruction.";
  if (has(text, "crash", "died", "exited", "killed", "sigterm", "sigkill"))
    return "The agent crashed partway through — Retry.";
  if (has(text, "build failed", "tests failed", "typecheck", "lint"))
    return "The change did not pass the project's checks — Retry with a note about what broke.";
  return "The agent stopped with an error — Retry, or open Technical details for why.";
}
