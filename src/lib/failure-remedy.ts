/**
 * What a failed runner command means, and therefore what button to show.
 *
 * /control once rendered Retry beside every failure. For "no running agent"
 * that button is a lie: the target is identically absent on every attempt, so
 * it fails identically, forever. A retry is only honest when repeating the
 * same action could plausibly produce a different result.
 *
 * SSOT note: the phrases here are the ones the runner composes its errors
 * FROM (desktop/src/main/poller.ts). scripts/test/failure-message-pairing.ts
 * reads the runner's throws and asserts each one is recognised, so a reworded
 * message on either side fails a test instead of drawing the wrong button.
 */
export const FAILURE_PHRASE = {
  /** The tab has no owned agent PTY on that runner; a dispatch starts one. */
  NO_RUNNING_AGENT: "no running agent for",
  /** The project's agent is not installed on the builder that took the
   *  command (lib/agents/launch-check agentNotInstalledMessage). */
  AGENT_NOT_INSTALLED: "is not installed on",
} as const;

export const FAILURE_REMEDY = {
  /** Start a session for the tab; then the command can run. */
  START_SESSION: "start-session",
  /** Repeating the same command could succeed (transient). */
  RETRY: "retry",
  /** The agent is missing on that builder: the same command with an agent
   *  that IS there. Repeating it unchanged fails identically. */
  SWITCH_AGENT: "switch-agent",
} as const;
export type FailureRemedy = (typeof FAILURE_REMEDY)[keyof typeof FAILURE_REMEDY];

/**
 * What the button for each remedy actually SAYS.
 *
 * Here rather than in the component because prose elsewhere has to name the
 * same control, and naming it by hand is how the two drifted: /control stopped
 * rendering Retry for "no running agent" (it was a lie — the target is
 * identically absent on every attempt), but two sentences kept telling the
 * reader to look for Retry in exactly that case. The behaviour was fixed; the
 * copy describing it was not, so the reader hunted for a button that is
 * deliberately absent.
 */
export const REMEDY_LABEL: Record<FailureRemedy, string> = {
  [FAILURE_REMEDY.START_SESSION]: "Start session",
  [FAILURE_REMEDY.RETRY]: "Retry",
  [FAILURE_REMEDY.SWITCH_AGENT]: "Use another agent",
};

/** The label Attention will show for a failure with this error text. Use this
 *  when writing copy that points the reader at that button. */
export function remedyLabelFor(error: string | null | undefined): string {
  return REMEDY_LABEL[remedyForFailure(error)];
}

export function remedyForFailure(error: string | null | undefined): FailureRemedy {
  const text = (error ?? "").toLowerCase();
  if (text.includes(FAILURE_PHRASE.NO_RUNNING_AGENT)) return FAILURE_REMEDY.START_SESSION;
  if (text.includes(FAILURE_PHRASE.AGENT_NOT_INSTALLED)) return FAILURE_REMEDY.SWITCH_AGENT;
  return FAILURE_REMEDY.RETRY;
}
