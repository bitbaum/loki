/**
 * Server half of the fix ledger (see fix-shipping.ts): find the PR the run
 * produced, ask GitHub where it is, cache the answer on the run.
 *
 * Economics: one PR lookup plus, once merged, one workflow-runs lookup, per
 * run, at most every REFRESH_MS while the state can still change, never
 * again once it is terminal. A deploy_failed verdict adds one workflow-runs
 * listing, at most every DEPLOY_FAILED_RECHECK_MS for 30 days after the merge. The inbox calls this for the handful of rows
 * sitting in "needs verify"; a fleet with fifty such rows costs fifty small
 * GitHub calls a minute at worst.
 */
import {
  applyServedRelease,
  awaitsServedRelease,
  fetchServedRelease,
  relationFromCompare,
} from "@/lib/feedback/served-release";
import { GITHUB_API_BASE } from "@/lib/github-api";
import { getRepoWriteToken, lokiKeepsCode } from "@/lib/github-org-token";
import { findCodeCustodyByGitUrl } from "@/db/queries/user-projects";
import { stampRunFix } from "@/db/queries/orchestration-runs";
import { decideAutoShip, prOwnership } from "@/lib/feedback/auto-ship";
import {
  deriveShippingFromPr,
  healDeployFailed,
  pickDeployRun,
  FIX_SHIP_STATE,
  fixNeedsRefresh,
  parsePrRef,
  resolveFixPrRef,
  type FixShipping,
  type GithubPrDetail,
  type GithubWorkflowRun,
  type PrRef,
} from "@/lib/feedback/fix-shipping";

/** Rows the inbox is willing to refresh per request — bounded on purpose. */
export const FIX_REFRESH_MAX_PER_REQUEST = 8;
export { fixNeedsRefresh };

export type FixRefreshInput = {
  runId: string;
  userId: string;
  /** The run's cached ledger, if any. */
  cached: FixShipping | null | undefined;
  /** The agent's handoff `done` line — where it names its PR. */
  summaryDone: string | null | undefined;
  /** The reaper's repo evidence, if it found one (payload.evidence). */
  evidence: { kind: string; url: string; title: string } | null | undefined;
  gitUrl: string | null | undefined;
  /**
   * user_projects.auto_ship — may Loki merge this PR itself?
   *
   * REQUIRED, not optional, and deliberately so. As an optional field it was
   * simply never passed: the switch saved, the row read "PR #1 · open", and
   * decideAutoShip was never reached, because `autoShip === true` is false for
   * undefined just as it is for false. A feature that silently disables itself
   * when a caller forgets a key is a feature with no gate — so the gate is the
   * type. Pass `null` to mean "not chosen"; there is no way to omit it.
   */
  autoShip: boolean | null;
  /** Has an automatic ship on this project already broken the deploy? */
  deployBroken: boolean;
  /**
   * When the run started. REQUIRED: it is the only fact that ties a pull
   * request to this run, and automatic merging refuses without it.
   */
  runStartedAt: string | Date | null;
  /**
   * The run's own branches (lib/run-branches), and whether its runner
   * reported any. REQUIRED for the same reason as runStartedAt: time alone
   * let the ledger take a pull request somebody opened on another branch
   * while the run was open, report it as the run's, and merge it.
   */
  runBranches: { own: readonly string[]; reported: boolean };
  /** The pull request the runner reported when it closed the run on it
   *  (payload.prUrl): seen at the agent's own HEAD, so as good as the handoff
   *  naming it. */
  reportedPrUrl?: string | null;
  /**
   * Where the project is served. REQUIRED for the reason autoShip is: left
   * optional it is simply not passed, and "is it live" falls back to
   * workflow-run labels that are wrong on this fleet (feedback/served-
   * release.ts). Pass null for a project with no address.
   */
  liveUrl: string | null;
  /**
   * The client said "Make it live" on a change opened as a draft for them:
   * take it out of draft first, then decide as for any other pull request.
   * Only ever true together with autoShip (effectiveAutoShip).
   */
  readyDraft?: boolean;
  /**
   * A client's change still waiting for their yes. The agent is told to open
   * it as a draft; one that did not is put back into draft here, so a merge
   * bot cannot ship it first. Only a pull request this run opened.
   */
  keepDraft?: boolean;
};

function ghInit(token: string): RequestInit {
  return {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  };
}

async function fetchPr(ref: PrRef, token: string): Promise<GithubPrDetail | null> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
    ghInit(token),
  );
  if (!res.ok) return null;
  const raw = (await res.json()) as Partial<GithubPrDetail> & {
    head?: { sha?: string; ref?: string };
    base?: { ref?: string };
    created_at?: string;
    body?: string | null;
    node_id?: string;
  };
  const j = raw;
  if (typeof j.number !== "number" || typeof j.html_url !== "string") return null;
  return {
    number: j.number,
    html_url: j.html_url,
    title: typeof j.title === "string" ? j.title : `PR #${j.number}`,
    state: j.state === "closed" ? "closed" : "open",
    merged_at: typeof j.merged_at === "string" ? j.merged_at : null,
    merge_commit_sha: typeof j.merge_commit_sha === "string" ? j.merge_commit_sha : null,
    draft: j.draft === true,
    mergeable: typeof j.mergeable === "boolean" ? j.mergeable : null,
    headSha: typeof raw.head?.sha === "string" ? raw.head.sha : null,
    headRef: typeof raw.head?.ref === "string" ? raw.head.ref : null,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
    baseRef: typeof raw.base?.ref === "string" ? raw.base.ref : null,
    body: typeof raw.body === "string" ? raw.body : null,
    nodeId: typeof raw.node_id === "string" ? raw.node_id : null,
  };
}

/**
 * Put a pull request into or out of draft. A client's change is a draft so
 * that nothing — not the repository's own merge bot either — can put it live
 * before the client says so; their "Make it live" is what lifts it. REST has
 * no endpoint for either, only GraphQL. Never throws.
 */
async function setDraft(nodeId: string, token: string, draft: boolean): Promise<boolean> {
  const mutation = draft ? "convertPullRequestToDraft" : "markPullRequestReadyForReview";
  try {
    const res = await fetch(`${GITHUB_API_BASE}/graphql`, {
      ...ghInit(token),
      method: "POST",
      headers: {
        ...(ghInit(token).headers as Record<string, string>),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`,
        variables: { id: nodeId },
      }),
    });
    if (!res.ok) return false;
    const j = (await res.json().catch(() => null)) as {
      data?: Record<string, { pullRequest?: { isDraft?: boolean } } | undefined>;
    } | null;
    return j?.data?.[mutation]?.pullRequest?.isDraft === draft;
  } catch {
    return false;
  }
}

/** Draft/mergeable + the conclusions of the checks on the PR head — the two
 *  facts decideAutoShip needs that a PR lookup alone does not carry. */
async function fetchMergeReadiness(
  ref: PrRef,
  headSha: string,
  token: string,
): Promise<{ checkConclusions: (string | null)[] } | null> {
  // check-runs covers GitHub Actions; commit statuses cover older integrations
  // (a repo can use either, and "no checks at all" must stay distinguishable
  // from "checks that passed").
  const [runsRes, statusRes] = await Promise.all([
    fetch(
      `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=50`,
      ghInit(token),
    ).catch(() => null),
    fetch(
      `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(headSha)}/status`,
      ghInit(token),
    ).catch(() => null),
  ]);
  if (!runsRes?.ok && !statusRes?.ok) return null;
  const conclusions: (string | null)[] = [];
  if (runsRes?.ok) {
    const j = (await runsRes.json().catch(() => null)) as {
      check_runs?: Array<{ status?: string; conclusion?: string | null }>;
    } | null;
    for (const r of j?.check_runs ?? [])
      conclusions.push(r.status === "completed" ? (r.conclusion ?? null) : null);
  }
  if (statusRes?.ok) {
    const j = (await statusRes.json().catch(() => null)) as {
      statuses?: Array<{ state?: string }>;
    } | null;
    for (const st of j?.statuses ?? [])
      conclusions.push(st.state === "success" ? "success" : (st.state ?? null));
  }
  return { checkConclusions: conclusions };
}

/** Squash-merge the PR. Returns GitHub's answer, never throws. */
async function mergePr(ref: PrRef, token: string, title: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/merge`,
      {
        ...ghInit(token),
        method: "PUT",
        headers: {
          ...(ghInit(token).headers as Record<string, string>),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merge_method: "squash",
          commit_title: `${title} (#${ref.number})`,
          commit_message: "Shipped automatically by Loki: a visitor's feedback, fixed.",
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchRunsForSha(
  ref: PrRef,
  sha: string,
  token: string,
): Promise<GithubWorkflowRun[] | null> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
    ghInit(token),
  );
  if (!res.ok) return null;
  return readRuns(await res.json());
}

/** GitHub's workflow-runs listing → the fields the ledger reads. */
function readRuns(body: unknown): GithubWorkflowRun[] {
  const j = body as { workflow_runs?: Array<Record<string, unknown>> } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return (j?.workflow_runs ?? []).map((r) => {
    const hc = r.head_commit as { message?: unknown; timestamp?: unknown } | null | undefined;
    return {
      name: str(r.name),
      status: str(r.status),
      conclusion: str(r.conclusion),
      html_url: str(r.html_url),
      workflow_id: typeof r.workflow_id === "number" ? r.workflow_id : null,
      head_branch: str(r.head_branch),
      head_sha: str(r.head_sha),
      event: str(r.event),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      head_commit: hc ? { message: str(hc.message), timestamp: str(hc.timestamp) } : null,
    };
  });
}

/**
 * The deploy workflow's most recent runs, on EVERY branch. Deliberately no
 * `branch=` (or `status=`) filter: GitHub sometimes answers filtered run
 * listings from a stale index (fleet#146), and a stale answer here would keep
 * a healed fix reading "deploy failed". pickLaterBaseDeploy filters on
 * head_branch itself.
 */
async function fetchRecentWorkflowRuns(
  ref: PrRef,
  workflowId: number,
  token: string,
): Promise<GithubWorkflowRun[] | null> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/actions/workflows/${workflowId}/runs?per_page=30&exclude_pull_requests=true`,
    ghInit(token),
  );
  if (!res.ok) return null;
  return readRuns(await res.json());
}

/**
 * The merge commit's own deploy failed: has a later deploy of the base branch
 * shipped it since? One extra call, made only for a DEPLOY_FAILED verdict —
 * which fixNeedsRefresh re-checks at most every DEPLOY_FAILED_RECHECK_MS.
 */
async function healFromLaterDeploy(
  fix: FixShipping,
  pr: GithubPrDetail,
  mergeRuns: GithubWorkflowRun[] | null,
  ref: PrRef,
  token: string,
): Promise<FixShipping> {
  if (fix.state !== FIX_SHIP_STATE.DEPLOY_FAILED || !pr.baseRef) return fix;
  const own = mergeRuns ? pickDeployRun(mergeRuns) : null;
  if (!own?.workflow_id) return fix;
  const runs = await fetchRecentWorkflowRuns(ref, own.workflow_id, token).catch(() => null);
  return healDeployFailed(fix, { baseBranch: pr.baseRef, workflowId: own.workflow_id, runs });
}

async function compareCommits(
  ref: PrRef,
  base: string,
  head: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`,
    ghInit(token),
  );
  if (!res.ok) return null;
  const status = ((await res.json()) as { status?: unknown } | null)?.status;
  return typeof status === "string" ? status : null;
}

/**
 * A merged change that the workflow runs do not show as live: ask the site
 * what it serves (feedback/served-release.ts). One public read and, when the
 * served commit is not the merge itself, one GitHub compare; made only for a
 * ledger that is merged and not yet live.
 */
async function liveFromServedRelease(
  fix: FixShipping,
  ref: PrRef,
  liveUrl: string | null,
  token: string,
): Promise<FixShipping> {
  if (!liveUrl || !awaitsServedRelease(fix)) return fix;
  const served = await fetchServedRelease(liveUrl);
  if (!served) return fix;
  const mergeSha = fix.pr!.mergeSha!.toLowerCase();
  const relation =
    served.commit === mergeSha
      ? "contains"
      : relationFromCompare(
          await compareCommits(ref, mergeSha, served.commit, token).catch(() => null),
        );
  return applyServedRelease(fix, served, relation, `${ref.owner}/${ref.repo}`);
}

/** Where the PR is named — resolveFixPrRef is the SSOT, shared with the
 *  cache-validity check in attach-work.ts so the two can never disagree. */
function findPrRef(input: FixRefreshInput): PrRef | null {
  return resolveFixPrRef({
    summaryDone: input.summaryDone,
    evidence: input.evidence,
    gitUrl: input.gitUrl,
  });
}

/**
 * Compute the ledger for one run and cache it. Never throws: GitHub down or
 * no token yields an `unverified` entry that still carries the PR link the
 * handoff named, so the row can at least point at it.
 */
export async function refreshFixShipping(input: FixRefreshInput): Promise<FixShipping> {
  const checkedAt = new Date().toISOString();
  const ref = findPrRef(input);
  let fix: FixShipping;
  if (!ref) {
    fix =
      input.evidence?.kind === "push"
        ? {
            state: FIX_SHIP_STATE.PUSHED,
            push: { url: input.evidence.url, title: input.evidence.title },
            checkedAt,
          }
        : { state: FIX_SHIP_STATE.NO_EVIDENCE, checkedAt };
  } else {
    const claimed: FixShipping = {
      state: FIX_SHIP_STATE.PR_OPEN,
      pr: { number: ref.number, url: ref.url, title: `PR #${ref.number}` },
      checkedAt,
      unverified: true,
    };
    try {
      // The person's OAuth token is NOT enough: `bitbaum` has OAuth-app access
      // restrictions, so GitHub answers 403 for every org repo even with the
      // right scope — the ledger read "PR #2 · open?" while that PR had merged
      // and deployed.
      //
      // This is a read, and getRepoWriteToken is named for writes, but it is
      // the picker that already encodes the rule this needs: the server's org
      // token for accounts entitled to fleet infrastructure, the person's own
      // otherwise. Reusing it means the ledger cannot hand an unentitled
      // account a credential the rest of the app withholds — and an external
      // user whose org refuses their token gets the honest `unverified` row
      // below rather than a silent escalation.
      // Loki-kept code reads with the server's token for whoever owns it;
      // a repository the person linked themselves reads with theirs.
      const custody = input.gitUrl
        ? await findCodeCustodyByGitUrl(input.userId, input.gitUrl).catch(() => null)
        : null;
      const picked = await getRepoWriteToken(input.userId, {
        lokiKept: lokiKeepsCode({ gitUrl: input.gitUrl ?? null, codeCustody: custody }),
      });
      if (!picked) fix = claimed;
      else {
        const pr = await fetchPr(ref, picked.token);
        const owner = pr
          ? prOwnership({
              prCreatedAt: pr.createdAt,
              headRef: pr.headRef,
              runStartedAt: input.runStartedAt,
              runBranches: input.runBranches,
              namedInHandoff:
                parsePrRef(input.summaryDone, input.gitUrl)?.number === pr.number ||
                (input.reportedPrUrl
                  ? parsePrRef(input.reportedPrUrl, input.gitUrl)?.number === pr.number
                  : false),
            })
          : null;
        if (!pr || !owner) fix = claimed;
        else if (!owner.runs) {
          // The pull request is older than the run that claims it, so the run
          // cannot have produced it — the number came out of prose the agent
          // wrote, and it belongs to other work.
          //
          // Loki ALREADY refused to merge this pull request for exactly this
          // reason (AUTO_SHIP_HOLD.NOT_OURS). It went on reporting it anyway:
          // deriveShippingFromPr ran on every ledger regardless, so a mentioned
          // number that happened to be merged and deployed rendered
          // "Live · confirm" on a report nothing had been done about. That is
          // the worst thing this surface can say — the operator's queue exists
          // to tell them what still needs them, and a false Live removes a row
          // from that queue. Refusing to act on evidence while still publishing
          // a conclusion from it was never coherent; one rule, both decisions.
          //
          // The same holds for a pull request on a branch that is not this
          // run's (2026-11-12: run 70d1a78d was shown loki#1636, which a person
          // had opened on another branch while the run was open).
          fix = {
            state: FIX_SHIP_STATE.NO_EVIDENCE,
            pr: { number: pr.number, url: pr.html_url, title: pr.title },
            foreignPr: true,
            checkedAt,
          };
        } else {
          const runs =
            pr.merged_at && pr.merge_commit_sha
              ? await fetchRunsForSha(ref, pr.merge_commit_sha, picked.token)
              : null;
          fix = await healFromLaterDeploy(
            deriveShippingFromPr(pr, runs, checkedAt),
            pr,
            runs,
            ref,
            picked.token,
          );
          fix = await liveFromServedRelease(fix, ref, input.liveUrl, picked.token);
          if (
            input.keepDraft &&
            fix.state === FIX_SHIP_STATE.PR_OPEN &&
            !pr.draft &&
            pr.nodeId &&
            owner.mayAct
          )
            await setDraft(pr.nodeId, picked.token, true);
          // Opted in? Then Loki presses merge on THIS pull request —
          // the one its own dispatch produced — and nothing else. Deciding is
          // pure (auto-ship.ts); this only supplies GitHub's facts and acts.
          if (input.autoShip === true && fix.state === FIX_SHIP_STATE.PR_OPEN && pr.headSha) {
            // Lifted from draft just now, GitHub recomputes mergeability, so
            // this pass holds on "unknown" and the next one merges.
            if (
              pr.draft &&
              input.readyDraft &&
              pr.nodeId &&
              (await setDraft(pr.nodeId, picked.token, false))
            )
              pr.draft = false;
            const readiness = await fetchMergeReadiness(ref, pr.headSha, picked.token);
            const decision = decideAutoShip({
              autoShip: input.autoShip,
              fix,
              fromOurDispatch: owner.mayAct,
              draft: pr.draft === true,
              mergeable: pr.mergeable ?? null,
              checkConclusions: readiness?.checkConclusions ?? [],
              deployBroken: input.deployBroken,
            });
            if (decision.merge && (await mergePr(ref, picked.token, pr.title))) {
              // Re-read rather than assume: the merge answer says "accepted",
              // and what the row must show is where the change IS now.
              const after = await fetchPr(ref, picked.token);
              if (after) {
                const afterRuns =
                  after.merged_at && after.merge_commit_sha
                    ? await fetchRunsForSha(ref, after.merge_commit_sha, picked.token)
                    : null;
                fix = {
                  ...deriveShippingFromPr(after, afterRuns, checkedAt),
                  shippedByFleet: true,
                };
              }
            } else if (!decision.merge) {
              fix = { ...fix, autoShipHold: decision.hold };
            }
          }
        }
      }
    } catch {
      fix = claimed;
    }
  }
  await stampRunFix(input.runId, input.userId, fix).catch(() => {});
  return fix;
}
