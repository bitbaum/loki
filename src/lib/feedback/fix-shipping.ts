/**
 * The fix ledger — what happened to a fix AFTER the agent finished.
 *
 * "Check live" used to appear the moment a run closed with success, and it
 * opened whatever URL the visitor had reported. Both halves were wrong. The
 * agent's job ends at a pull request (compose-dispatch's SHIP_INSTRUCTION),
 * so at close time the change is a PR nobody has merged, on a site nobody
 * has redeployed — "check live" would show the unchanged page. And the
 * reported URL is where the visitor happened to be (a preview, a stale host,
 * a fixture), not where the product lives.
 *
 * This module is the pure half: the shape of "where the fix is", how to find
 * the PR the agent named, how to read GitHub's answer, and the one canonical
 * "live page" URL. The server half (fix-shipping-refresh.ts) talks to GitHub
 * and caches the result on the run.
 */

export const FIX_SHIP_STATE = {
  /** Run said success, but no PR, push or commit could be found. */
  NO_EVIDENCE: "no_evidence",
  /** A branch was pushed; no PR opened. */
  PUSHED: "pushed",
  /** PR exists and is open. The repo's own path (auto-merge or a human) decides. */
  PR_OPEN: "pr_open",
  /** PR closed without merging. Nothing shipped. */
  PR_CLOSED: "pr_closed",
  /** Merged; no deploy observed yet (or the repo has no deploy workflow). */
  MERGED: "merged",
  /** Merged and a deploy-like workflow is still running on the merge commit. */
  DEPLOYING: "deploying",
  /** Merged and a deploy-like workflow succeeded on the merge commit. */
  DEPLOYED: "deployed",
  /**
   * Merged and the deploy-like workflow failed on the merge commit, and no
   * later deploy of the base branch has shipped it since. NOT terminal: every
   * later successful deploy of that branch contains the merge, so this heals
   * into DEPLOYED (see healDeployFailed) — within DEPLOY_FAILED_HEAL_WINDOW_MS.
   */
  DEPLOY_FAILED: "deploy_failed",
} as const;
export type FixShipState = (typeof FIX_SHIP_STATE)[keyof typeof FIX_SHIP_STATE];

export type FixShipping = {
  state: FixShipState;
  pr?: {
    number: number;
    url: string;
    title: string;
    mergedAt?: string | null;
    mergeSha?: string | null;
  };
  push?: { url: string; title: string };
  deploy?: { url: string | null; name: string; conclusion: string | null; status: string | null };
  /**
   * Set when the merge commit's OWN deploy failed and a later deploy of the
   * base branch shipped the change instead. `deploy` is then that later run and
   * `ownDeploy` the failed one, so a reader can say "went live with a later
   * deploy" rather than pretending the merge deployed by itself.
   */
  liveVia?: "later_deploy";
  ownDeploy?: { url: string | null; name: string; conclusion: string | null };
  /** ISO — when GitHub was last asked. */
  checkedAt: string;
  /** No GitHub token / API failure: the state is what the handoff claimed, unverified. */
  unverified?: boolean;
  /**
   * The pull request named in `pr` is NOT this run's work: GitHub says it was
   * already open before the run was dispatched. The state is therefore
   * NO_EVIDENCE — the reference is kept so the row can say which pull request
   * it discounted, rather than leaving a reader to wonder what the agent meant.
   */
  foreignPr?: boolean;
  /** Loki merged this itself because the project opted in. */
  shippedByFleet?: boolean;
  /** Automatic shipping is on but declined to merge — why (see auto-ship.ts). */
  autoShipHold?: string;
};

/** How long a non-terminal ledger entry is trusted before GitHub is asked again. */
export const FIX_REFRESH_MS = 60_000;

/**
 * A DEPLOY_FAILED ledger is re-checked this rarely. It changes only when a
 * later deploy of the base branch succeeds, and asking costs three GitHub
 * calls, so it gets a slower clock than the states that move within minutes.
 */
export const DEPLOY_FAILED_RECHECK_MS = 15 * 60_000;

/**
 * …and only this long after the merge. It used to be terminal, which froze PR
 * #540's rows at "deploy failed" for two weeks while dozens of later deploys of
 * main shipped the merge — and, because an open deploy_failed row pauses the
 * project's automatic shipping, froze that too. A month is far past the point
 * where a healthy repo has deployed again; after it the verdict stands.
 */
export const DEPLOY_FAILED_HEAL_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * Should GitHub be asked again?
 *
 * `expectedPrUrl` is the pull request the CURRENT parser resolves from the
 * handoff. A cache is only valid for the input it was computed from, and this
 * one outlived its input: a parser bug resolved the wrong pull request, landed
 * the row in PR_CLOSED — a terminal state — and terminal meant "never ask
 * again". So the fix for the parser could not reach a single row it had
 * already poisoned; the row said "nothing shipped" forever while the real
 * pull request sat open (dogfood-site-sep10-1201, 2026-09-11, cleared by hand).
 *
 * Re-parsing is pure and free. Asking GitHub is what costs, and that is still
 * gated by terminality and the refresh window — but only when the cached
 * answer is about the pull request we would resolve today.
 */
export function fixNeedsRefresh(
  cached: FixShipping | null | undefined,
  // An options object, not positional arguments: this function already had a
  // trailing `now`, and slipping a new parameter in front of it is how a
  // caller silently passes a timestamp as a URL.
  opts: { expectedPrUrl?: string | null; now?: number } = {},
): boolean {
  const { expectedPrUrl } = opts;
  const now = opts.now ?? Date.now();
  if (!cached) return true;
  // The cache answers a question we would no longer ask. Terminal or not, it
  // is about the wrong pull request.
  if (expectedPrUrl && cached.pr && cached.pr.url !== expectedPrUrl) return true;
  // We can now resolve a pull request and the cache never had one.
  if (expectedPrUrl && !cached.pr) return true;
  if (isFixShipTerminal(cached.state)) return false;
  const t = Date.parse(cached.checkedAt);
  if (cached.state === FIX_SHIP_STATE.DEPLOY_FAILED) {
    // Bounded both ways: a slow clock, and a horizon measured from the merge
    // (from the last check when the merge time was never recorded).
    const merged = Date.parse(cached.pr?.mergedAt ?? "");
    const since = Number.isFinite(merged) ? merged : t;
    if (Number.isFinite(since) && now - since > DEPLOY_FAILED_HEAL_WINDOW_MS) return false;
    return !Number.isFinite(t) || now - t > DEPLOY_FAILED_RECHECK_MS;
  }
  return !Number.isFinite(t) || now - t > FIX_REFRESH_MS;
}

/**
 * Sort key for "which ledger is most overdue a look": when it was last checked,
 * 0 when never. Exported because the ordering IS the fix for a starvation bug —
 * the inbox refreshes a bounded number of rows per request, and taking them in
 * list order (newest first) meant everything past the bound was never looked at
 * again. Oldest-first turns that bound into a rate limit instead.
 */
export function fixCheckedAtMs(fix: FixShipping | null | undefined): number {
  const t = fix?.checkedAt ? Date.parse(fix.checkedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Which ledger transitions are worth interrupting someone for. */
export type ShipAnnouncement = "live" | "deploy_failed";

/**
 * Pure: does moving from `before` to `after` deserve an announcement?
 *
 * Only transitions announce. A row that was already deployed and is read again
 * must stay silent, or every inbox load would re-announce every past fix.
 */
export function shipAnnouncementFor(
  before: FixShipping | null | undefined,
  after: FixShipping | null | undefined,
): ShipAnnouncement | null {
  if (!after) return null;
  if (before?.state === after.state) return null;
  if (after.state === FIX_SHIP_STATE.DEPLOYED) return "live";
  if (after.state === FIX_SHIP_STATE.DEPLOY_FAILED) return "deploy_failed";
  return null;
}

/** States that never change again — no point asking GitHub. DEPLOY_FAILED is
 *  not one: a later deploy of the base branch heals it, on its own bounded
 *  clock in fixNeedsRefresh. */
export function isFixShipTerminal(state: FixShipState): boolean {
  return state === FIX_SHIP_STATE.DEPLOYED || state === FIX_SHIP_STATE.PR_CLOSED;
}

export type PrRef = { owner: string; repo: string; number: number; url: string };

export function parseGithubRepoRef(
  gitUrl: string | null | undefined,
): { owner: string; repo: string } | null {
  const m = (gitUrl ?? "").trim().match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * The PR the agent named in its handoff — "opened PR #2 on branch …",
 * "https://github.com/o/r/pull/7". Full URLs win over bare numbers (a bare
 * number needs the project's repo to mean anything). Returns null rather than
 * guessing when neither is present.
 */
/**
 * The pull request the agent named in its handoff.
 *
 * A handoff mentions MORE THAN ONE number more often than you would think —
 * a retry says "prior PR #1 diverged and conflicted (closed #1, opened #3)".
 * Taking the first match reported the CLOSED pull request and told the
 * operator nothing had shipped, while #3 sat open and mergeable (observed on
 * dogfood-site-sep10-1201, 2026-09-11). So: prefer a reference the sentence
 * marks as the one the agent OPENED, and fall back to the highest number,
 * because a later pull request supersedes an earlier one.
 */
export function parsePrRef(
  text: string | null | undefined,
  gitUrl: string | null | undefined,
): PrRef | null {
  const t = text ?? "";
  const refs = collectPrRefs(t, gitUrl);
  if (!refs.length) return null;
  const opened = refs.find((r) => r.opened);
  if (opened) return opened.ref;
  return refs.reduce((best, r) => (r.ref.number > best.ref.number ? r : best)).ref;
}

/** Every PR reference in the text, in order, each flagged when the words just
 *  before it say the agent opened (rather than closed or superseded) it. */
function collectPrRefs(
  t: string,
  gitUrl: string | null | undefined,
): Array<{ ref: PrRef; opened: boolean }> {
  const repo = parseGithubRepoRef(gitUrl);
  const out: Array<{ ref: PrRef; opened: boolean }> = [];
  const seen = new Set<string>();
  // A full URL carries its own owner/repo, so it works without a registered
  // git URL; a bare "#3" only means something against the project's repo.
  const pattern =
    /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)|\bPR\s*#(\d+)|\bpull request\s*#(\d+)|\bpull\/(\d+)\b|\bopened\s+#(\d+)\b/gi;
  for (const m of t.matchAll(pattern)) {
    let ref: PrRef | null = null;
    if (m[1] && m[2] && m[3]) {
      const number = Number(m[3]);
      ref = {
        owner: m[1],
        repo: m[2],
        number,
        url: `https://github.com/${m[1]}/${m[2]}/pull/${number}`,
      };
    } else if (repo) {
      const n = Number(m[4] ?? m[5] ?? m[6] ?? m[7]);
      if (Number.isFinite(n) && n > 0)
        ref = {
          owner: repo.owner,
          repo: repo.repo,
          number: n,
          url: `https://github.com/${repo.owner}/${repo.repo}/pull/${n}`,
        };
    }
    if (!ref || seen.has(ref.url)) continue;
    seen.add(ref.url);
    // "opened PR #3", "opened #3", "opened https://…/pull/3" — the 40
    // characters before the match are enough to tell opening from closing.
    const before = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    out.push({ ref, opened: /\bopen(?:ed|s|ing)?\b[^.]{0,20}$/i.test(before) });
  }
  return out;
}

/**
 * THE pull request this run's fix lives in. One function, because two callers
 * deciding this separately is how a cache ends up permanently disagreeing with
 * the thing that fills it: the refresher preferred the reaper's evidence while
 * the cache-validity check read only the handoff, so a run whose evidence and
 * handoff named different pull requests re-fetched GitHub on every single
 * request, forever.
 *
 * The reaper's evidence wins when it has a pull request, because it is
 * window-bounded fact from the GitHub API rather than prose the model wrote.
 */
export function resolveFixPrRef(input: {
  summaryDone?: string | null;
  evidence?: { kind?: string | null; url?: string | null } | null;
  gitUrl?: string | null;
}): PrRef | null {
  if (input.evidence?.kind === "pr" && input.evidence.url) {
    const fromEvidence = parsePrRef(input.evidence.url, input.gitUrl);
    if (fromEvidence) return fromEvidence;
  }
  return parsePrRef(input.summaryDone, input.gitUrl);
}

/** GitHub's PR object, only the fields the ledger reads. */
export type GithubPrDetail = {
  number: number;
  html_url: string;
  title: string;
  state: "open" | "closed";
  merged_at: string | null;
  merge_commit_sha: string | null;
  /** Only read when deciding whether Loki may merge it (see auto-ship.ts). */
  draft?: boolean;
  /** null while GitHub is still computing mergeability — never treat as true. */
  mergeable?: boolean | null;
  headSha?: string | null;
  /** When GitHub says the pull request was opened. The only hard evidence that
   *  ties a pull request to the run that supposedly produced it. */
  createdAt?: string | null;
  /** The branch it merged into (`base.ref`) — whose later deploys carry it. */
  baseRef?: string | null;
};
/** GitHub's workflow run object, only the fields the ledger reads. */
export type GithubWorkflowRun = {
  name: string | null;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | …
  html_url: string | null;
  /** Read only when healing a DEPLOY_FAILED verdict (pickLaterBaseDeploy). */
  workflow_id?: number | null;
  head_branch?: string | null;
  head_sha?: string | null;
  event?: string | null;
  created_at?: string | null;
  head_commit?: { message?: string | null; timestamp?: string | null } | null;
};

const DEPLOY_NAME = /deploy|ship|release|publish/i;

/** Which of the merge commit's workflow runs is the deploy, if any. A repo
 *  with only a CI workflow has none — then "merged" is as far as we can see. */
export function pickDeployRun(runs: readonly GithubWorkflowRun[]): GithubWorkflowRun | null {
  const deployish = runs.filter((r) => DEPLOY_NAME.test(r.name ?? ""));
  if (!deployish.length) return null;
  // Prefer a decisive answer: success > failure > still running.
  return (
    deployish.find((r) => r.conclusion === "success") ??
    deployish.find((r) => r.conclusion && r.conclusion !== "skipped") ??
    deployish.find((r) => r.status !== "completed") ??
    deployish[0]
  );
}

export function deriveShippingFromPr(
  pr: GithubPrDetail,
  mergeRuns: readonly GithubWorkflowRun[] | null,
  checkedAt: string,
): FixShipping {
  const base = {
    pr: {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      mergedAt: pr.merged_at,
      mergeSha: pr.merge_commit_sha,
    },
    checkedAt,
  };
  if (!pr.merged_at) {
    return {
      ...base,
      state: pr.state === "open" ? FIX_SHIP_STATE.PR_OPEN : FIX_SHIP_STATE.PR_CLOSED,
    };
  }
  const deploy = mergeRuns ? pickDeployRun(mergeRuns) : null;
  if (!deploy) return { ...base, state: FIX_SHIP_STATE.MERGED };
  const d = {
    url: deploy.html_url,
    name: deploy.name ?? "deploy",
    conclusion: deploy.conclusion,
    status: deploy.status,
  };
  if (deploy.conclusion === "success")
    return { ...base, deploy: d, state: FIX_SHIP_STATE.DEPLOYED };
  if (deploy.status !== "completed" || deploy.conclusion === null)
    return { ...base, deploy: d, state: FIX_SHIP_STATE.DEPLOYING };
  if (deploy.conclusion === "skipped") return { ...base, deploy: d, state: FIX_SHIP_STATE.MERGED };
  return { ...base, deploy: d, state: FIX_SHIP_STATE.DEPLOY_FAILED };
}

/**
 * Pure: the later successful deploy of the base branch that shipped a merge
 * whose own deploy failed, or null.
 *
 * `runs` is a page of the deploy workflow's runs listed WITHOUT GitHub's
 * `branch=` filter — branch-filtered listings are sometimes answered from a
 * stale index (fleet#146) — so the branch is filtered here, on `head_branch`.
 *
 * A run counts only when all of these hold:
 *  - it succeeded, on the base branch, and is not a pull-request run;
 *  - it is the same workflow as the failed one, when that is known;
 *  - it is not the merge commit's own run (those were already judged);
 *  - it was created AFTER the merge — a success before the merge shipped the
 *    old version, which is exactly what the failed verdict says is live;
 *  - its head commit is dated at or after the merge. The branch's history past
 *    the merge contains it; an earlier-dated commit may be a CI commit that
 *    predates the merge and finished late. Rejecting one can only keep a true
 *    "deploy failed", never invent a false "live".
 * And no run after the merge may ship a commit that REVERTS this pull request —
 * a cheap check over data already fetched, not a full history scan.
 * The latest qualifying run wins: it is the one serving now.
 */
export function pickLaterBaseDeploy(input: {
  mergedAt: string | null | undefined;
  mergeSha: string | null | undefined;
  baseBranch: string | null | undefined;
  prNumber: number;
  workflowId?: number | null;
  runs: readonly GithubWorkflowRun[];
}): GithubWorkflowRun | null {
  const merged = Date.parse(input.mergedAt ?? "");
  if (!Number.isFinite(merged) || !input.baseBranch) return null;
  const after = input.runs.filter((r) => {
    if (r.head_branch !== input.baseBranch) return false;
    if (r.event === "pull_request" || r.event === "pull_request_target") return false;
    if (input.workflowId != null && r.workflow_id != null && r.workflow_id !== input.workflowId)
      return false;
    const created = Date.parse(r.created_at ?? "");
    return Number.isFinite(created) && created > merged;
  });
  if (after.some((r) => revertsPr(r.head_commit?.message, input.prNumber))) return null;
  const shipped = after.filter((r) => {
    if (r.status !== "completed" || r.conclusion !== "success") return false;
    if (input.mergeSha && r.head_sha === input.mergeSha) return false;
    const committed = Date.parse(r.head_commit?.timestamp ?? "");
    return Number.isFinite(committed) && committed >= merged;
  });
  if (!shipped.length) return null;
  return shipped.reduce((a, b) =>
    Date.parse(b.created_at ?? "") > Date.parse(a.created_at ?? "") ? b : a,
  );
}

/** Does this commit message revert pull request #n? GitHub's revert button
 *  writes `Revert "<title> (#n)"`; a hand-written one usually names the number. */
export function revertsPr(message: string | null | undefined, prNumber: number): boolean {
  const m = message ?? "";
  return /^revert\b/i.test(m) && new RegExp(`#${prNumber}(?!\\d)`).test(m);
}

/**
 * Pure: a DEPLOY_FAILED ledger becomes DEPLOYED once a later deploy of the base
 * branch shipped the merge. Anything else passes through unchanged.
 */
export function healDeployFailed(
  fix: FixShipping,
  input: {
    baseBranch: string | null | undefined;
    workflowId?: number | null;
    runs: readonly GithubWorkflowRun[] | null;
  },
): FixShipping {
  if (fix.state !== FIX_SHIP_STATE.DEPLOY_FAILED || !fix.pr || !input.runs) return fix;
  const later = pickLaterBaseDeploy({
    mergedAt: fix.pr.mergedAt,
    mergeSha: fix.pr.mergeSha,
    baseBranch: input.baseBranch,
    prNumber: fix.pr.number,
    workflowId: input.workflowId,
    runs: input.runs,
  });
  if (!later) return fix;
  return {
    ...fix,
    state: FIX_SHIP_STATE.DEPLOYED,
    liveVia: "later_deploy",
    ...(fix.deploy
      ? {
          ownDeploy: {
            url: fix.deploy.url,
            name: fix.deploy.name,
            conclusion: fix.deploy.conclusion,
          },
        }
      : {}),
    deploy: {
      url: later.html_url,
      name: later.name ?? fix.deploy?.name ?? "deploy",
      conclusion: later.conclusion,
      status: later.status,
    },
  };
}

/**
 * Where to look at the change: the project's live origin plus the path the
 * visitor reported. The reported host is only a fallback — a visitor on a
 * preview deployment or a fixture URL reports from there, and the product
 * lives at liveUrl. Returns null when neither yields an absolute URL.
 */
export function livePageHref(
  liveUrl: string | null | undefined,
  reportedUrl: string | null | undefined,
  page: string | null | undefined,
): string | null {
  let path = "";
  // The widget sends the page as an absolute URL on some hosts and as a path
  // on others; either field may carry the absolute one.
  const reported =
    [reportedUrl, page].map((v) => (v ?? "").trim()).find((v) => /^https?:\/\//i.test(v)) ?? "";
  if (/^https?:\/\//i.test(reported)) {
    try {
      const u = new URL(reported);
      path = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      /* fall through */
    }
  } else if ((page ?? "").trim().startsWith("/")) {
    path = (page ?? "").trim();
  }
  const live = (liveUrl ?? "").trim();
  if (/^https?:\/\//i.test(live)) {
    try {
      const origin = new URL(live).origin;
      return `${origin}${path || "/"}`;
    } catch {
      /* fall through */
    }
  }
  if (/^https?:\/\//i.test(reported)) {
    try {
      return new URL(reported).toString();
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** First sentence of the agent's `done` line, for the row — the handoff is
 *  written for another engineer and runs to a paragraph. */
export function firstSentence(text: string | null | undefined, max = 160): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const m = t.match(/^(.{20,}?[.;])\s/);
  const s = (m ? m[1] : t).trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
