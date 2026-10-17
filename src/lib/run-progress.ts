/**
 * Run progress — the one signal that says "the agent is still working".
 *
 * A dispatch produced exactly three run events for a whole day of work:
 * dispatched, submitted, closed. Between "submitted" and "closed" — typically
 * 20–60 minutes — nothing was written anywhere, so every surface that read the
 * run (Feedback, Control) had to guess, and guessed "Queued", then "Not
 * running", while the agent was in fact busy. The runner owns the agent's PTY
 * and sees every byte it prints; that is the source of truth, and this module
 * is the contract between the runner that reports it and the surfaces that
 * read it.
 *
 * The runner beats at most once per RUN_PROGRESS_BEAT_MS, and only when the
 * PTY printed something since the last beat — a silent agent produces no
 * beats, so "no progress for RUN_PROGRESS_FRESH_MS" honestly means stalled.
 */
export const RUN_PROGRESS_BEAT_MS = 45_000;
/** A beat older than this no longer proves life: the phase turns from
 *  Working to Stalled. Same window the feedback phase always used for
 *  "prompt delivered, but nothing since". */
export const RUN_PROGRESS_FRESH_MS = 10 * 60_000;
/** Belt and braces: a run that keeps printing for longer than this is a
 *  runaway; the runner stops beating and the phase turns Stalled, which is
 *  the honest state for something a human has to look at. */
export const RUN_PROGRESS_MAX_MS = 6 * 60 * 60_000;

/**
 * Why an agent that is not printing is not printing.
 *
 * Silence has two very different meanings and the operator can only act on
 * one. "Thinking" needs nothing; "waiting at a login prompt" needs THEM, now.
 * On 2026-09-12 a dispatch sat silent for thirteen minutes because the cloud
 * agent wanted a sign-in, and the product said only "no output" — so George
 * opened a terminal by hand to discover it. The runner can already tell these
 * apart (detectAuthFailure); it just never said so after the first 8 seconds.
 */
export const RUN_BLOCKED = {
  /** The agent needs someone to sign in before it can do anything. */
  AUTH: "auth",
} as const;
export type RunBlocked = (typeof RUN_BLOCKED)[keyof typeof RUN_BLOCKED];

export type RunProgressBeat = {
  /** PTY bytes printed since the previous beat. */
  outputBytes: number;
  /** When the PTY last printed anything (ISO). */
  lastOutputAt: string;
  /** Set when the runner can name why the terminal is quiet. */
  blocked?: RunBlocked | null;
  /** What the agent is doing now, in a few words (lib/run-step), when the
   *  runner can read its session log. */
  step?: string;
};

/** The longest step a beat may carry. */
export const RUN_STEP_MAX_CHARS = 160;

export function isRunProgressFresh(
  lastProgressAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastProgressAt) return false;
  const t = Date.parse(lastProgressAt);
  if (Number.isNaN(t)) return false;
  return now - t < RUN_PROGRESS_FRESH_MS;
}

/** Pure decision the runner's timer makes on every tick. */
/**
 * How long a delivered run may print nothing before the runner stops assuming
 * it is thinking and goes and looks at why.
 *
 * Well inside the ten minutes after which a reader is told the run is not
 * running: the point is to have the REASON ready before the row has to say
 * anything, not to explain the silence afterwards.
 */
export const RUN_SILENCE_BEFORE_DIAGNOSIS_MS = 90_000;

export function shouldDiagnoseSilence(
  s: { bytesSinceBeat: number; lastOutputAt: number },
  now = Date.now(),
): boolean {
  return s.bytesSinceBeat <= 0 && now - s.lastOutputAt >= RUN_SILENCE_BEFORE_DIAGNOSIS_MS;
}

export function shouldBeat(
  s: { bytesSinceBeat: number; lastBeatAt: number; startedAt: number; blocked?: RunBlocked | null },
  now = Date.now(),
): "beat" | "wait" | "stop" {
  if (now - s.startedAt > RUN_PROGRESS_MAX_MS) return "stop";
  // A blocked agent prints nothing, so the "no output, no beat" rule would
  // suppress exactly the beat that carries the reason. Silence is the message
  // here — send it, still no more than once per window.
  if (s.bytesSinceBeat <= 0 && !s.blocked) return "wait";
  if (now - s.lastBeatAt < RUN_PROGRESS_BEAT_MS) return "wait";
  return "beat";
}
