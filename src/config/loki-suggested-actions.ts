/**
 * Loki start-page chips — SSOT for what the composer offers.
 *
 * Three states, three actions each. Dispatch chips only appear once a project
 * is scoped, because unscoped "move forward" / "code review" cannot run.
 */

export type LokiChipKind = "send" | "prefill" | "open_projects" | "href";

export type LokiComposerChip = {
  id: string;
  label: string;
  kind: LokiChipKind;
  /** NL for send/prefill. `{project}` is replaced when one project is scoped. */
  template?: string;
  href?: string;
  /** Send as chat (no dispatch). Fleet questions, not agent work. */
  chatOnly?: boolean;
};

export const LOKI_NEW_PROJECT_HREF = "/control/new-from-scratch";
export const LOKI_IMPORT_PROJECT_HREF = "/control/import";

/**
 * The openers, and why they are worded this way.
 *
 * Each names the surfaces it wants, because the retrieval planner reads the
 * words of the question to decide what to fetch. A starter that says "review
 * my fleet" plans projects; one that says "runs, feedback and approvals" plans
 * those too. The chip text is therefore load-bearing, not decoration — and it
 * is the reason the old "What needs me" could only ever answer about projects.
 *
 * Each also forbids the listing behaviour a modest model falls into when handed
 * an index: name a few things and say why, rather than reciting the fleet.
 */
export const LOKI_ATTENTION_PROMPT =
  "What needs me right now? Check the fleet status, the runs that are waiting or errored, unread visitor feedback, open alerts, and anything pending my approval. Give me the 3 things that most need me, newest first, one line each saying what it is and why it matters. Give the time for anything time-sensitive. If nothing needs me, say so plainly. Don't list everything.";

export const LOKI_FEEDBACK_PROMPT =
  "What visitor feedback has come in recently? For each report give the project, when it was filed, what it says, and what happened to it — was it dispatched to an agent, is a run still waiting, or is nothing happening with it yet?";

export const LOKI_RUNS_PROMPT =
  "How are my agent runs doing? Show what is waiting to be picked up, what errored in the last 24 hours, and what is working right now. For anything waiting or failed, say how long it has been that way and whether the runner is even connected.";

const NEW_PROJECT_CHIP: LokiComposerChip = {
  id: "new_project",
  label: "New project",
  kind: "href",
  href: LOKI_NEW_PROJECT_HREF,
};

const IMPORT_PROJECT_CHIP: LokiComposerChip = {
  id: "import_project",
  label: "I have one",
  kind: "href",
  href: LOKI_IMPORT_PROJECT_HREF,
};

/**
 * "I have one" for an account that belongs to projects it does not own (a
 * seat): those projects, on /projects. It opened the GitHub import, which
 * asked QA's Viewer seat to link a GitHub account it does not have, beside a
 * project it already had (QA seat walk, 2026-11-12). Import stays one tap away.
 */
const YOUR_PROJECTS_CHIP: LokiComposerChip = {
  id: "your_projects",
  label: "I have one",
  kind: "href",
  href: "/projects",
};

const IMPORT_SECONDARY_CHIP: LokiComposerChip = {
  id: "import_project",
  label: "Import from GitHub",
  kind: "href",
  href: LOKI_IMPORT_PROJECT_HREF,
};

const OPEN_PROJECT_CHIP: LokiComposerChip = {
  id: "open_project",
  label: "Open a project",
  kind: "open_projects",
};

const ATTENTION_CHIP: LokiComposerChip = {
  id: "attention",
  label: "What needs me",
  kind: "send",
  chatOnly: true,
  template: LOKI_ATTENTION_PROMPT,
};

export const LOKI_SCOPED_CHIPS: LokiComposerChip[] = [
  {
    id: "move_forward",
    label: "Move forward",
    kind: "send",
    template: "move forward on {project}",
  },
  { id: "quality", label: "Review", kind: "send", template: "code review for {project}" },
  {
    id: "test_and_fix",
    label: "Fix tests",
    kind: "send",
    template: "fix types and tests for {project}",
  },
];

export function fillSuggestedAction(template: string, projectName: string | null): string {
  if (projectName) return template.replaceAll("{project}", projectName);
  return template
    .replace(/\s+(?:on|for|in)\s+\{project\}/gi, "")
    .replaceAll("{project}", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function composerChips(input: {
  projectCount: number;
  /** Projects shared with this account by someone else. */
  sharedProjectCount?: number;
  selectedProjects: string[];
  selectedGoal?: { title: string } | null;
}): LokiComposerChip[] {
  const selected = input.selectedProjects;
  if (selected.length === 1) {
    const name = selected[0];
    const goal = input.selectedGoal;
    if (goal?.title) {
      return [
        {
          id: "active_goal",
          label: "Move forward",
          kind: "send",
          template: `Move ${name} toward its active goal: ${goal.title}. Inspect the current state and complete the highest-impact next step you can verify.`,
        },
        LOKI_SCOPED_CHIPS[1],
        LOKI_SCOPED_CHIPS[2],
      ];
    }
    return LOKI_SCOPED_CHIPS;
  }
  if (selected.length > 1) {
    return [
      { id: "move_forward_many", label: "Move forward", kind: "send", template: "move forward" },
      { id: "quality_many", label: "Review", kind: "send", template: "code review" },
      {
        id: "test_and_fix_many",
        label: "Fix tests",
        kind: "send",
        template: "fix types and tests",
      },
    ];
  }
  if (input.projectCount === 0 && (input.sharedProjectCount ?? 0) > 0) {
    return [NEW_PROJECT_CHIP, YOUR_PROJECTS_CHIP, IMPORT_SECONDARY_CHIP];
  }
  if (input.projectCount === 0) {
    return [NEW_PROJECT_CHIP, IMPORT_PROJECT_CHIP];
  }
  return [NEW_PROJECT_CHIP, OPEN_PROJECT_CHIP, ATTENTION_CHIP];
}

/** Fleet-wide openers for the floating assistant (other pages). */
export type LokiProactiveStarter = { id: string; label: string; prompt: string };

export const LOKI_PROACTIVE_STARTERS: LokiProactiveStarter[] = [
  { id: "attention", label: "What needs me", prompt: LOKI_ATTENTION_PROMPT },
  { id: "runs", label: "How are my runs", prompt: LOKI_RUNS_PROMPT },
  { id: "feedback", label: "Latest feedback", prompt: LOKI_FEEDBACK_PROMPT },
];
