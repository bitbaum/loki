/**
 * What the OrangeCat → Loki build handoff does on arrival.
 *
 * The default is to build: consume the intent, create the project, and land on
 * it with the kickoff already running (profile → milestones → repository →
 * agent). That is the one click the "Build it with Loki" button
 * promises. Two cases must NOT auto-create:
 *
 *   - `connected`: this entity already has a Loki project. Creating a
 *     second one is the duplicate the picker exists to prevent; open the one
 *     that exists.
 *   - `exactMatch`: a project with the same name exists but is not linked.
 *     "Bitbaum" on both products is almost certainly one thing; only a person
 *     can say so. Show the picker.
 *
 * `review` is the operator's explicit request to choose first (`?review=1`).
 * Pure so the rule is pinned by a test rather than by reading JSX.
 */
export type HandoffMode = "auto" | "review" | "connected";

export function decideHandoffMode(input: {
  review: boolean;
  connected: boolean;
  exactMatch: boolean;
}): HandoffMode {
  if (input.connected) return "connected";
  if (input.review || input.exactMatch) return "review";
  return "auto";
}

/** Query flag the project page reads to start the kickoff without a click. */
export const KICKOFF_AUTO_PARAM = "kickoff";
export const KICKOFF_AUTO_VALUE = "auto";

/**
 * Query flag that opens the interview instead — what a NEW project gets.
 *
 * A project created from a handoff knows a title and one public sentence, and
 * the kickoff turns exactly that text into a profile, a roadmap and an agent's
 * brief. Starting there means the first thing Loki does with a new customer is
 * build confidently from almost nothing. So a new project stops to ask first,
 * and reaches the kickoff a few sentences later with a profile worth building
 * from. An EXISTING project that was merely linked gets neither flag — linking
 * is not consent to start work on it, which was already true and stays true.
 */
export const INTERVIEW_AUTO_PARAM = "interview";
export const INTERVIEW_AUTO_VALUE = "auto";

/** The project URL the API returned, with the auto-kickoff flag appended. */
export function kickoffAutoHref(projectUrl: string): string {
  return withFlag(projectUrl, KICKOFF_AUTO_PARAM, KICKOFF_AUTO_VALUE);
}

/** The same URL, flagged to open the interview before anything is built. */
export function interviewAutoHref(projectUrl: string): string {
  return withFlag(projectUrl, INTERVIEW_AUTO_PARAM, INTERVIEW_AUTO_VALUE);
}

function withFlag(projectUrl: string, param: string, value: string): string {
  const sep = projectUrl.includes("?") ? "&" : "?";
  return `${projectUrl}${sep}${param}=${value}`;
}

export function isKickoffAuto(value: string | string[] | undefined): boolean {
  return value === KICKOFF_AUTO_VALUE;
}

export function isInterviewAuto(value: string | string[] | undefined): boolean {
  return value === INTERVIEW_AUTO_VALUE;
}
