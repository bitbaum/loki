/**
 * Cold start — SSOT for what "make it happen" has to do on a given project.
 *
 * Every piece of starting a project already existed: AI profile fill (a chip in
 * the Context section), roadmap → goals (a second chip inside that chip's
 * drawer), repo provisioning (inside a collapsed "Project settings" details),
 * and dispatch (a link to another page). Nothing was missing except the
 * composition — so starting a project meant knowing all four affordances, their
 * order, and where each one hides. That is the cognitive load, and it is what
 * this module removes: state which steps a project still needs, in order, once.
 *
 * The hero runs exactly `planKickoff()` and nothing else, so the UI can never
 * disagree with the readiness check that decides whether to show it.
 */
import { PROJECT_ATTR } from "@/config/project-attrs";
import { hasAnswer } from "@/lib/project-display";

export const KICKOFF_STEPS = ["profile", "milestones", "repo", "dispatch"] as const;
export type KickoffStepId = (typeof KICKOFF_STEPS)[number];

/** Present-tense labels — the hero shows these live as each step runs. */
export const KICKOFF_STEP_LABEL: Record<KickoffStepId, string> = {
  profile: "Filling the profile",
  milestones: "Planning the milestones",
  repo: "Creating the repository",
  dispatch: "Putting an agent on it",
};

/**
 * The profile fields an agent needs before it can build the RIGHT thing.
 * Deliberately not all eight: mission/problem/solution/stack are what change
 * the work. Vision and conventions are nice to have and must not gate a start.
 */
export const KICKOFF_CORE_PROFILE_KEYS = [
  PROJECT_ATTR.MISSION,
  PROJECT_ATTR.PROBLEM,
  PROJECT_ATTR.SOLUTION,
  PROJECT_ATTR.STACK,
] as const;

/** Mirrors the brief route's floor — below this there is nothing to extract. */
export const KICKOFF_MIN_DESCRIPTION = 10;

/**
 * Long enough to brief an agent with. NOT a gate — an advisory.
 *
 * The floor above is 10 characters, which "a time capsule" clears. Zeitkastli
 * (called HamsterCheek when this happened, renamed 2026-09-15) sat at one
 * sentence and every derived thing was thin in exactly that way:
 * the extractor could not infer a stack from it and wrote "Unknown" instead.
 * Everything the button produces is a function of this text, so a brief that
 * clears the floor but says almost nothing deserves to be pointed at rather
 * than silently accepted. Roughly two sentences.
 */
export const KICKOFF_THIN_DESCRIPTION = 200;

/** Enough to run, but thin enough that the results will show it. */
export function isThinBrief(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length >= KICKOFF_MIN_DESCRIPTION && t.length < KICKOFF_THIN_DESCRIPTION;
}

export type KickoffSetupInput = {
  attrs: Record<string, string>;
  goalCount: number;
  hasRepo: boolean;
};

/** The setup steps this project is still missing (never includes dispatch). */
export function missingKickoffSetup(input: KickoffSetupInput): KickoffStepId[] {
  const steps: KickoffStepId[] = [];
  // hasAnswer, not truthiness: a field holding "Unknown" is a field the
  // extractor could not fill, so the profile step is exactly what it needs.
  if (KICKOFF_CORE_PROFILE_KEYS.some((key) => !hasAnswer(input.attrs[key]))) steps.push("profile");
  if (input.goalCount === 0) steps.push("milestones");
  if (!input.hasRepo) steps.push("repo");
  return steps;
}

/**
 * The ordered run plan. Repo creation is the one irreversible step, so it is
 * opt-out (`wantRepo`) rather than implied; dispatch always closes the plan —
 * a kickoff that sets everything up and then puts nobody to work is the
 * cognitive-load bug in a new costume.
 */
export function planKickoff(input: KickoffSetupInput & { wantRepo: boolean }): KickoffStepId[] {
  const setup = missingKickoffSetup(input).filter((step) => step !== "repo" || input.wantRepo);
  return [...setup, "dispatch"];
}

/** Is there enough written down to brief an agent with? */
export function hasKickoffSource(description: string | null | undefined): boolean {
  return (description ?? "").trim().length >= KICKOFF_MIN_DESCRIPTION;
}

/**
 * Whether the cold-start hero belongs on this page at all. A project with a
 * live agent is already happening, and one that is fully set up is served by
 * the ordinary "Run next step" button — the hero is for the cold case only.
 */
export function needsKickoff(input: KickoffSetupInput & { agentRunning: boolean }): boolean {
  if (input.agentRunning) return false;
  return missingKickoffSetup(input).length > 0;
}
