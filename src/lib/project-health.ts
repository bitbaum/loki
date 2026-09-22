/**
 * Derived project health — the SSOT that replaces the hand-typed
 * `attrs.maturity` "N/10" magic number. The score is the count of ten named,
 * verifiable checks, so "why 9 and not 10" is always answerable: every point
 * traces to a concrete fact of the profile, and every missing point names the
 * exact action that earns it.
 *
 * Inputs are limited to fields available on BOTH the catalog row and the full
 * dossier (entity + attrs + code paths) so the same number renders everywhere
 * — a score that differed between the list and the profile would be a new lie.
 */
import { cleanDescription, hasAnswer } from "@/lib/project-display";
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";

export type ProjectHealthInput = {
  description: string | null;
  gitUrl?: string | null;
  dirPath?: string | null;
  /** First-class live_url on user_projects. Attrs are the fallback. */
  liveUrl?: string | null;
  attrs: Record<string, string>;
};

/**
 * How a missing point is earned, from wherever the score is shown.
 *
 * A breakdown that only NAMES the gap still leaves the person to go find the
 * right tab and the right field — which is most of the work, and the reason a
 * score people cannot move is a score people ignore. Every check therefore
 * carries the write that earns it, so the panel can perform it in place.
 *
 *  - `attr`  → POST /api/projects/{id}/attrs  (one text field)
 *  - `description` → PATCH /api/projects/{id} (first-class column)
 *  - `clear` → DELETE .../attrs — the three signal checks pass when EMPTY, so
 *              the point is earned by resolving the problem and clearing it.
 */
export type ProjectHealthFix =
  | { kind: "attr"; attr: string; placeholder: string; multiline?: boolean }
  | { kind: "description"; placeholder: string; multiline?: boolean }
  | { kind: "liveUrl"; placeholder: string; multiline?: boolean }
  | { kind: "clear"; attr: string };

export type ProjectHealthCheck = {
  key: string;
  label: string;
  pass: boolean;
  /** For failing checks: the concrete action that earns the point.
   *  For passing checks: the fact that earned it. */
  detail: string;
  /** The exact condition, in words — "how is this calculated" answered on
   *  screen rather than in this file. Shown next to every check. */
  rule: string;
  fix: ProjectHealthFix;
};

export type ProjectHealth = {
  score: number;
  max: number;
  checks: ProjectHealthCheck[];
};

const truncate = (value: string, n = 80) =>
  value.length > n ? `${value.slice(0, n - 1)}…` : value;

/**
 * A definition_of_done earns its point only if a turn can EVIDENCE it.
 *
 * The grader reads the handoff and nothing else, so the bar has to name
 * something an agent can run and report. Anything phrased as a property of the
 * finished product is unfalsifiable per turn and silently converts good work
 * into `partial` — which is indistinguishable, from the outside, from an agent
 * that did nothing.
 *
 * Deliberately a keyword check and not an LLM call: this renders on every
 * project card, and a cheap heuristic that catches "money is not a float" is
 * worth far more than a perfect judgment nobody can afford to run.
 */
// Listed, not inlined into the regex, because the panel SHOWS this list as the
// rule for the check. A user asked to satisfy a keyword test is owed the
// keywords; deriving the pattern from the list is what stops the two drifting.
export const CHECKABLE_DONE_KEYWORDS = [
  "verify",
  "test",
  "tests",
  "tsc",
  "typecheck",
  "type-check",
  "lint",
  "build",
  "deploy",
  "deploys",
  "deployed",
  "ci",
  "green",
  "commit",
  "committed",
  "pushed",
  "passes",
  "passing",
  "health",
] as const;

const CHECKABLE_DONE_MARKERS = new RegExp(`\\b(${CHECKABLE_DONE_KEYWORDS.join("|")})\\b`, "i");

export function isCheckableDoneBar(value: string | undefined | null): boolean {
  return hasAnswer(value) && CHECKABLE_DONE_MARKERS.test(value!);
}

export function computeProjectHealth(input: ProjectHealthInput): ProjectHealth {
  const attrs = input.attrs;
  const description = cleanDescription(input.description ?? attrs["description"] ?? null);
  const liveUrl = input.liveUrl || attrs["production_url"] || attrs["url"];
  const repo = input.gitUrl || attrs["repo"] || attrs["github_repo"];

  const checks: ProjectHealthCheck[] = [
    {
      key: "brief",
      label: "Brief written",
      pass: Boolean(description),
      detail: description
        ? truncate(description)
        : "Write a one-line description of what this project is.",
      rule: "Passes when the project has a description.",
      fix: {
        kind: "description",
        placeholder: "What is this project, in one line?",
        multiline: true,
      },
    },
    {
      key: "mission",
      label: "Mission stated",
      pass: hasAnswer(attrs["mission"]),
      detail: hasAnswer(attrs["mission"])
        ? truncate(attrs["mission"])
        : "State the mission in Context — agents build toward it.",
      rule: "Passes when Context → Mission is filled in.",
      fix: {
        kind: "attr",
        attr: "mission",
        placeholder: "What is this project ultimately for?",
        multiline: true,
      },
    },
    {
      key: "code",
      label: "Code connected",
      pass: Boolean(repo || input.dirPath),
      detail: repo
        ? truncate(repo)
        : input.dirPath
          ? truncate(input.dirPath)
          : "Link a repository or local path so agents can work on it.",
      rule: "Passes when a repository or a local path is set.",
      fix: {
        kind: "attr",
        attr: "repo",
        placeholder: "owner/repo, or a full git URL",
        multiline: false,
      },
    },
    {
      key: "live",
      label: "Live URL",
      pass: hasAnswer(liveUrl),
      detail: hasAnswer(liveUrl)
        ? truncate(liveUrl)
        : "Add a production URL when something is deployed.",
      rule: "Passes when a production URL is set.",
      // The live_url COLUMN, not the production_url attr, even though this
      // check reads both. Writing the attr earned the point while the page's
      // own "Add live URL" field — which reads only the column — went on
      // saying "add live URL". A point you can earn without the page agreeing
      // is worse than one you cannot earn at all.
      fix: { kind: "liveUrl", placeholder: "https://…" },
    },
    {
      key: "stage",
      label: "Stage declared",
      pass: hasAnswer(attrs["status"]),
      detail: hasAnswer(attrs["status"])
        ? attrs["status"]
        : "Set the lifecycle stage (planning / development / production).",
      rule: "Passes when a lifecycle stage is set.",
      fix: {
        kind: "attr",
        attr: "status",
        placeholder: "planning / development / production",
        multiline: false,
      },
    },
    // The three attention signals: an open callout costs a point until fixed.
    ...HEALTH_SIGNAL_BASE.map((signal) => ({
      key: signal.key,
      label: signal.clearLabel,
      pass: !hasAnswer(attrs[signal.key]),
      // Machine-built from `label` this read "No broken" / "No open broken
      // recorded." — a sentence with its noun missing, on every project page.
      // The wording is written per signal now (clearLabel) instead of derived.
      detail: hasAnswer(attrs[signal.key])
        ? truncate(attrs[signal.key])
        : `Nothing flagged — this point is lost if one is recorded.`,
      rule: signal.clearRule,
      fix: { kind: "clear" as const, attr: signal.key },
    })),
    {
      key: "next",
      label: "Next step queued",
      pass: hasAnswer(attrs["next_step"]),
      detail: hasAnswer(attrs["next_step"])
        ? truncate(attrs["next_step"])
        : "Queue the next step so work can be dispatched in one click.",
      rule: "Passes when a next step is written.",
      fix: {
        kind: "attr",
        attr: "next_step",
        placeholder: "The one thing to do next",
        multiline: true,
      },
    },
    {
      key: "done",
      label: "Definition of done",
      // Present is not enough — it has to be CHECKABLE. A different model grades
      // each handoff against this bar, and it sees only what the agent wrote. A
      // bar describing the finished product ("outcomes are tracked to improve
      // future recommendations") can never be evidenced in one turn, so every
      // run closes `partial` no matter how good the work was. That was the state
      // of 10 of 19 projects on 2026-08-04: 26 partial / 3 success in a week.
      pass: isCheckableDoneBar(attrs["definition_of_done"]),
      detail: !hasAnswer(attrs["definition_of_done"])
        ? "Define when a change counts as done — agents verify against it."
        : isCheckableDoneBar(attrs["definition_of_done"])
          ? truncate(attrs["definition_of_done"])
          : `Not checkable from a handoff — name a command (verify, test, lint, build, deploy) instead of describing the finished product. Currently: ${truncate(attrs["definition_of_done"])}`,
      // The one check with a rule you could not guess from its label, so it
      // states its own keyword list rather than making the field look broken.
      rule: `Passes when the bar names something an agent can run and report — it must contain one of: ${CHECKABLE_DONE_KEYWORDS.join(", ")}.`,
      fix: {
        kind: "attr",
        attr: "definition_of_done",
        placeholder: "e.g. npm run verify passes and the change is deployed",
        multiline: true,
      },
    },
  ];

  return {
    score: checks.filter((c) => c.pass).length,
    max: checks.length,
    checks,
  };
}

/**
 * The checks POST /api/projects/{id}/brief can close from the project's own
 * brief. Everything else is a fact only the person has: where the code lives,
 * where it is deployed, and whether a flagged problem is actually resolved.
 *
 * Listed rather than inferred so the button can say what it will do BEFORE it
 * runs, instead of reporting a surprise afterwards.
 */
export const AI_FILLABLE_CHECKS = new Set(["brief", "mission", "stage", "next", "done"]);

/** One-line agent/tooltip rendering: "7/10 — missing: Live URL, Next step queued". */
export function describeProjectHealth(health: ProjectHealth): string {
  const missing = health.checks.filter((c) => !c.pass).map((c) => c.label);
  return missing.length === 0
    ? `${health.score}/${health.max}`
    : `${health.score}/${health.max} — missing: ${missing.join(", ")}`;
}
