/**
 * What a running build has done so far, in the order it happened — the way an
 * engineer tells the person they work for "picked it up", "pushed the fix",
 * "opened the pull request", "checks are green".
 *
 * Before this, the chat card under a dispatch said "Agent is working · still
 * working · 7m" from the moment it started until the moment it stopped. The
 * owner, 2026-10-15: updates should read "like the team of engineers updating
 * the manager". The repository is where a builder's progress becomes a fact —
 * a commit with a message, a pull request with a title, checks with a result —
 * and it reads the same whichever builder (cloud, this computer, hosted) did
 * the work, so no runner has to learn to report anything new.
 *
 * Pure: run-milestones-fetch.ts asks GitHub; scripts/test/run-milestones.ts
 * pins this.
 */

export type ChecksState = "running" | "passed" | "failed";

export type RepoProgress = {
  /** Commits on the work branch since the run started, oldest first. */
  commits: { sha: string; message: string; at: string; url: string }[];
  pr: {
    number: number;
    title: string;
    url: string;
    at: string;
    checks: ChecksState | null;
  } | null;
};

export type RunMilestone = {
  key: "picked_up" | "commit" | "pr" | "checks";
  label: string;
  /** The words the builder wrote: a commit message, a PR title. */
  quote: string | null;
  href: string | null;
  at: string;
  tone: "positive" | "neutral" | "warning" | "negative";
};

/** The newest few commits; a run that pushed twenty does not need twenty rows. */
const COMMITS_SHOWN = 3;
const QUOTE_MAX = 140;

/** A commit message's first line, without the conventional-commit prefix
 *  ("fix(header): …"), which is a label for tools, not for a person. */
export function commitHeadline(message: string): string {
  const first = (message.split("\n")[0] ?? "").trim();
  const bare = first.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
  const text = bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : first;
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text;
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : d);

export function buildRunMilestones(input: {
  startedAt: string | Date | null;
  repo: RepoProgress | null;
}): RunMilestone[] {
  const out: RunMilestone[] = [];
  if (input.startedAt) {
    out.push({
      key: "picked_up",
      label: "Picked up — reading the code",
      quote: null,
      href: null,
      at: iso(input.startedAt),
      tone: "neutral",
    });
  }
  const commits = input.repo?.commits ?? [];
  const shown = commits.slice(-COMMITS_SHOWN);
  const hidden = commits.length - shown.length;
  shown.forEach((c, i) => {
    out.push({
      key: "commit",
      label:
        i === 0 && hidden > 0
          ? `Pushed ${hidden + 1} commits, the latest:`
          : commits.length === 1
            ? "Pushed a change"
            : "Pushed",
      quote: commitHeadline(c.message),
      href: c.url,
      at: c.at,
      tone: "positive",
    });
  });
  const pr = input.repo?.pr;
  if (pr) {
    out.push({
      key: "pr",
      label: `Opened pull request #${pr.number}`,
      quote: pr.title,
      href: pr.url,
      at: pr.at,
      tone: "positive",
    });
    if (pr.checks) {
      const latest = [pr.at, ...commits.map((c) => c.at)].sort().at(-1)!;
      out.push({
        key: "checks",
        label:
          pr.checks === "passed"
            ? "Checks passed — it merges on its own"
            : pr.checks === "failed"
              ? "A check failed — the builder is expected to fix it"
              : "Checks are running",
        quote: null,
        href: `${pr.url}/checks`,
        at: latest,
        tone: pr.checks === "passed" ? "positive" : pr.checks === "failed" ? "negative" : "neutral",
      });
    }
  }
  // Commits and the PR come from different lists; the reader wants one story.
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** One conclusion from a commit's check runs. Nothing reported is null. */
export function summarizeChecks(
  runs: { status?: string | null; conclusion?: string | null }[],
): ChecksState | null {
  if (runs.length === 0) return null;
  if (runs.some((r) => ["failure", "timed_out", "action_required"].includes(r.conclusion ?? "")))
    return "failed";
  if (runs.some((r) => r.status !== "completed")) return "running";
  return "passed";
}
