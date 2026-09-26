// Pure tests: a "deploy failed" fix heals once a LATER deploy of the base
// branch has shipped it (src/lib/feedback/fix-shipping.ts → healDeployFailed).
//
// Regression pin: PR #540 on bitbaum/loki merged 2026-09-09; its own Deploy run
// failed, and the ledger said so for two weeks — "The live page still shows the
// old version" — while dozens of successful Deploy runs of main each shipped
// the merge. deploy_failed was terminal and judged only from the merge commit's
// own runs, and two such OPEN rows kept loki's automatic shipping paused.
import assert from "node:assert/strict";
import {
  DEPLOY_FAILED_HEAL_WINDOW_MS,
  DEPLOY_FAILED_RECHECK_MS,
  deriveShippingFromPr,
  FIX_SHIP_STATE,
  fixNeedsRefresh,
  healDeployFailed,
  pickLaterBaseDeploy,
  revertsPr,
  shipAnnouncementFor,
  type GithubWorkflowRun,
} from "../../src/lib/feedback/fix-shipping";
import { projectsPausedByBrokenDeploy } from "../../src/lib/feedback/auto-ship";

const MERGED_AT = "2026-09-09T16:07:00Z";
const MERGE_SHA = "4e7d20cc0a27c77edfad45c53887682ae933b9e3";
const WF = 308908997;

const pr = {
  number: 540,
  html_url: "https://github.com/bitbaum/loki/pull/540",
  title: "fix: something",
  state: "closed" as const,
  merged_at: MERGED_AT,
  merge_commit_sha: MERGE_SHA,
  baseRef: "main",
};

const ownFailed: GithubWorkflowRun = {
  name: "Deploy",
  status: "completed",
  conclusion: "failure",
  html_url: "https://github.com/bitbaum/loki/actions/runs/34378058710",
  workflow_id: WF,
  head_branch: "main",
  head_sha: MERGE_SHA,
  event: "workflow_dispatch",
  created_at: "2026-09-09T16:08:25Z",
  head_commit: { message: "fix: something (#540)", timestamp: MERGED_AT },
};

function run(over: Partial<GithubWorkflowRun>): GithubWorkflowRun {
  return {
    name: "Deploy",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/bitbaum/loki/actions/runs/1",
    workflow_id: WF,
    head_branch: "main",
    head_sha: "fd8085fe00000000000000000000000000000000",
    event: "workflow_dispatch",
    created_at: "2026-09-25T17:02:31Z",
    head_commit: {
      message: "fix(projects): list each project once (#923)",
      timestamp: "2026-09-25T17:00:00Z",
    },
    ...over,
  };
}

const at = "2026-09-25T18:00:00Z";
const failed = deriveShippingFromPr(pr, [ownFailed], at);
assert.equal(failed.state, FIX_SHIP_STATE.DEPLOY_FAILED, "fixture: its own deploy failed");

const heal = (runs: GithubWorkflowRun[] | null) =>
  healDeployFailed(failed, { baseBranch: "main", workflowId: WF, runs });

// 1. Own deploy failed + a later successful deploy of main → deployed, honestly labelled.
{
  const later = run({ html_url: "https://github.com/bitbaum/loki/actions/runs/36164600615" });
  const healed = heal([later, ownFailed]);
  assert.equal(healed.state, FIX_SHIP_STATE.DEPLOYED);
  assert.equal(healed.liveVia, "later_deploy", "says it went live via a later deploy");
  assert.equal(healed.deploy?.url, later.html_url, "deploy is the run that shipped it");
  assert.equal(healed.deploy?.conclusion, "success");
  assert.equal(healed.ownDeploy?.conclusion, "failure", "its own failed run is kept");
  assert.equal(healed.ownDeploy?.url, ownFailed.html_url);
  // The transition announces "live" (once — deployed is terminal), never "deploy failed".
  assert.equal(shipAnnouncementFor(failed, healed), "live");
  assert.equal(shipAnnouncementFor(healed, healed), null, "read again: silent");
  assert.equal(
    fixNeedsRefresh(healed, { now: Date.parse(at) + 10 * DEPLOY_FAILED_RECHECK_MS }),
    false,
  );
  // And the project is no longer paused by it.
  assert.equal(
    projectsPausedByBrokenDeploy([{ projectId: "p", status: "dispatched" }], () => healed, []).size,
    0,
  );
  assert.equal(
    projectsPausedByBrokenDeploy([{ projectId: "p", status: "dispatched" }], () => failed, []).size,
    1,
    "control: the unhealed row does pause",
  );
}

// 2. A later deploy that FAILED keeps deploy_failed.
{
  assert.equal(heal([run({ conclusion: "failure" })]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  assert.equal(heal([run({ conclusion: "cancelled" })]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  assert.equal(
    heal([run({ status: "in_progress", conclusion: null })]).state,
    FIX_SHIP_STATE.DEPLOY_FAILED,
  );
}

// 3. A successful deploy BEFORE the merge does not count — it shipped the old version.
{
  const before = run({
    created_at: "2026-09-09T16:00:40Z",
    head_sha: "15d22425",
    head_commit: { message: "earlier (#539)", timestamp: "2026-09-09T16:00:00Z" },
  });
  assert.equal(heal([before, ownFailed]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  // Created after the merge but shipping a commit made BEFORE it (a CI run that
  // finished late) is not proof either.
  const lateCi = run({
    created_at: "2026-09-09T16:10:00Z",
    head_commit: { message: "earlier (#539)", timestamp: "2026-09-09T16:00:00Z" },
  });
  assert.equal(heal([lateCi]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  // The boundary: created exactly at the merge is not after it.
  assert.equal(heal([run({ created_at: MERGED_AT })]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  // The merge commit's own successful re-run is already judged by deriveShippingFromPr.
  assert.equal(heal([run({ head_sha: MERGE_SHA })]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
}

// 4. No runs at all: merged stays merged, deploy_failed stays deploy_failed.
{
  assert.equal(heal(null).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  assert.equal(heal([]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  const merged = deriveShippingFromPr(pr, null, at);
  assert.equal(merged.state, FIX_SHIP_STATE.MERGED);
  assert.equal(
    healDeployFailed(merged, { baseBranch: "main", workflowId: WF, runs: [run({})] }).state,
    FIX_SHIP_STATE.MERGED,
    "only a deploy_failed verdict heals",
  );
}

// 5. The pure selection ignores runs on other branches, PR runs and other workflows.
{
  const pick = (runs: GithubWorkflowRun[]) =>
    pickLaterBaseDeploy({
      mergedAt: MERGED_AT,
      mergeSha: MERGE_SHA,
      baseBranch: "main",
      prNumber: 540,
      workflowId: WF,
      runs,
    });
  assert.equal(pick([run({ head_branch: "fix/other" })]), null, "other branch");
  assert.equal(pick([run({ event: "pull_request" })]), null, "pull-request run");
  assert.equal(pick([run({ workflow_id: 1 })]), null, "another workflow");
  assert.equal(heal([run({ head_branch: "staging" })]).state, FIX_SHIP_STATE.DEPLOY_FAILED);
  // The latest qualifying run wins.
  const a = run({ created_at: "2026-09-20T10:00:00Z", html_url: "a" });
  const b = run({ created_at: "2026-09-25T10:00:00Z", html_url: "b" });
  assert.equal(
    pick([a, b, run({ head_branch: "x", created_at: "2026-09-26T00:00:00Z", html_url: "c" })])
      ?.html_url,
    "b",
  );
}

// 6. A revert of this PR shipped after the merge keeps deploy_failed.
{
  assert.equal(revertsPr('Revert "fix: something (#540)"', 540), true);
  assert.equal(revertsPr('Revert "fix: something (#5401)"', 540), false);
  assert.equal(revertsPr("fix: something (#540)", 540), false);
  assert.equal(
    heal([
      run({}),
      run({
        head_commit: {
          message: 'Revert "fix: something (#540)"',
          timestamp: "2026-09-12T00:00:00Z",
        },
        created_at: "2026-09-12T00:01:00Z",
      }),
    ]).state,
    FIX_SHIP_STATE.DEPLOY_FAILED,
  );
}

// 7. Refresh economics: deploy_failed is re-checked, but on a slow clock and
//    only within the window after the merge.
{
  const now = Date.parse("2026-09-25T18:00:00Z");
  const cached = {
    ...failed,
    checkedAt: new Date(now - DEPLOY_FAILED_RECHECK_MS - 1).toISOString(),
  };
  assert.equal(fixNeedsRefresh(cached, { now }), true, "stale deploy_failed is asked again");
  assert.equal(
    fixNeedsRefresh({ ...failed, checkedAt: new Date(now - 60_001 * 2).toISOString() }, { now }),
    false,
    "but not on the one-minute clock",
  );
  assert.equal(
    fixNeedsRefresh(cached, { now: Date.parse(MERGED_AT) + DEPLOY_FAILED_HEAL_WINDOW_MS + 1 }),
    false,
    "past the window the verdict stands",
  );
}

console.log("deploy-failed-heals: ok");
