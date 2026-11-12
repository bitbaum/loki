/**
 * A pull request is a run's only when it is on one of the run's own branches.
 *
 * Production, 2026-11-12: run 70d1a78d on loki ran `git status` and nothing
 * else. Its page claimed loki#1636 as its pull request and "Pushed:" with
 * that pull request's commit. #1636 had been opened by hand on
 * `ops/grubenv-repair` while the run was open; "the newest pull request since
 * the run started" picked it up. docs/foundation/RUN-STATUS-SSOT.md: "A pull
 * request that is another run's is not proof."
 *
 * Run: npx tsx scripts/test/run-branches.ts
 */
import { findRepoWorkEvidence } from "@/lib/github-evidence";
import {
  RUN_BRANCHES_MAX,
  cleanBranchName,
  refBelongsToRun,
  runBranchName,
  runBranches,
  withReportedBranch,
  worktreeBranchName,
} from "@/lib/run-branches";
import { runBranchName as boxRunBranchName } from "@/lib/agent-execution/box-workspace";
import { worktreeBranch } from "@/lib/agent-execution/worktree-workspace";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const RUN = "70d1a78d-1111-4222-8333-444444444444";
const OTHER_RUN = "ef607eb7-1111-4222-8333-444444444444";
const STARTED = Date.parse("2026-11-12T03:50:00Z");
const GIT_URL = "https://github.com/bitbaum/loki";

type Pull = { number: number; head: string; created_at: string; bot?: boolean };
type Push = { ref: string; created_at: string };

/** GitHub, answering only the two calls findRepoWorkEvidence makes. */
function github(pulls: Pull[], pushes: Push[] = []) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/pulls?")
      ? pulls.map((p) => ({
          html_url: `${GIT_URL}/pull/${p.number}`,
          title: `pull ${p.number}`,
          created_at: p.created_at,
          user: p.bot ? { type: "Bot", login: "dependabot[bot]" } : { type: "User", login: "cato" },
          head: { ref: p.head },
        }))
      : pushes.map((p) => ({
          type: "PushEvent",
          created_at: p.created_at,
          payload: { ref: `refs/heads/${p.ref}` },
          actor: { login: "cato" },
        }));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

async function main() {
  await check("the names are the ones the builder really uses", () => {
    assert(runBranchName(RUN) === "loki/run-70d1a78d", runBranchName(RUN));
    assert(boxRunBranchName(RUN) === runBranchName(RUN), "box-workspace names it differently");
    assert(worktreeBranch(RUN) === worktreeBranchName(RUN), "worktree names it differently");
    assert(worktreeBranchName(RUN) === `fc/${RUN}`, worktreeBranchName(RUN));
  });

  await check("a run's branches are its own two and the ones its runner reported", () => {
    const got = runBranches({ id: RUN, payload: { branches: ["fix/home", "fix/home", 7] } });
    assert(
      got.join() === ["loki/run-70d1a78d", `fc/${RUN}`, "fix/home"].join(),
      `got ${got.join()}`,
    );
    assert(runBranches({ id: RUN, payload: null }).length === 2, "no payload");
    // Every merge is a push to main: sitting on it attributes nothing.
    const onMain = runBranches({ id: RUN, payload: { branches: ["main", "master"] } });
    assert(onMain.length === 2, `main counted as the run's: ${onMain.join()}`);
  });

  await check("a reported branch is cleaned, kept once, newest last, capped", () => {
    assert(cleanBranchName("refs/heads/fix/a\n") === "fix/a", "ref prefix and newline");
    assert(cleanBranchName("HEAD") === null, "a detached checkout is not a branch");
    assert(cleanBranchName("a..b") === null && cleanBranchName("a b") === null, "bad names");
    assert(cleanBranchName(12) === null, "not a string");
    assert(withReportedBranch(["a", "b"], "a").join() === "b,a", "moved to newest");
    assert(withReportedBranch(["a"], "HEAD").join() === "a", "HEAD ignored");
    const many = Array.from({ length: 12 }, (_, i) => `b${i}`);
    const capped = withReportedBranch(many, "new");
    assert(capped.length === RUN_BRANCHES_MAX && capped.at(-1) === "new", capped.join());
  });

  await check("another branch is not the run's, however alike", () => {
    const mine = runBranches({ id: RUN, payload: {} });
    assert(refBelongsToRun("loki/run-70d1a78d", mine), "its own run branch");
    assert(!refBelongsToRun(runBranchName(OTHER_RUN), mine), "another run's branch");
    assert(!refBelongsToRun("ops/grubenv-repair", mine), "a person's branch");
    assert(!refBelongsToRun("main", mine), "main, when the run was never reported on it");
    assert(!refBelongsToRun(null, mine), "no ref");
  });

  await check(
    "the incident: a pull request opened by hand in the run's window is not claimed",
    async () => {
      github([{ number: 1636, head: "ops/grubenv-repair", created_at: "2026-11-12T03:58:00Z" }]);
      const got = await findRepoWorkEvidence(GIT_URL, "t", STARTED, runBranches({ id: RUN }));
      assert(got === null, `claimed ${got?.url}`);
    },
  );

  await check("another run's pull request in the window is not claimed", async () => {
    github([{ number: 1700, head: runBranchName(OTHER_RUN), created_at: "2026-11-12T03:58:00Z" }]);
    const got = await findRepoWorkEvidence(GIT_URL, "t", STARTED, runBranches({ id: RUN }));
    assert(got === null, `claimed ${got?.url}`);
  });

  await check("the run's own pull request is found behind a newer stranger", async () => {
    github([
      { number: 1636, head: "ops/grubenv-repair", created_at: "2026-11-12T03:59:00Z" },
      { number: 1635, head: "loki/run-70d1a78d", created_at: "2026-11-12T03:55:00Z" },
    ]);
    const got = await findRepoWorkEvidence(GIT_URL, "t", STARTED, runBranches({ id: RUN }));
    assert(got?.kind === "pr" && got.url.endsWith("/pull/1635"), `got ${got?.url}`);
  });

  await check("a pull request on a branch the runner reported is the run's", async () => {
    github([{ number: 1701, head: "fix/home", created_at: "2026-11-12T03:58:00Z" }]);
    const branches = runBranches({ id: RUN, payload: { branches: ["fix/home"] } });
    const got = await findRepoWorkEvidence(GIT_URL, "t", STARTED, branches);
    assert(got?.url.endsWith("/pull/1701") === true, `got ${got?.url}`);
  });

  await check(
    "a pull request from before the run is never the run's, even on its branch",
    async () => {
      github([{ number: 1600, head: "fix/home", created_at: "2026-11-12T03:00:00Z" }]);
      const branches = runBranches({ id: RUN, payload: { branches: ["fix/home"] } });
      assert((await findRepoWorkEvidence(GIT_URL, "t", STARTED, branches)) === null, "claimed");
    },
  );

  await check("a push counts only on the run's own branch", async () => {
    github([], [{ ref: "ops/grubenv-repair", created_at: "2026-11-12T03:58:00Z" }]);
    const mine = runBranches({ id: RUN });
    assert((await findRepoWorkEvidence(GIT_URL, "t", STARTED, mine)) === null, "stranger's push");
    github(
      [],
      [
        { ref: "ops/grubenv-repair", created_at: "2026-11-12T03:59:00Z" },
        { ref: "loki/run-70d1a78d", created_at: "2026-11-12T03:58:00Z" },
      ],
    );
    const got = await findRepoWorkEvidence(GIT_URL, "t", STARTED, mine);
    assert(got?.kind === "push" && got.url.endsWith("/tree/loki/run-70d1a78d"), `got ${got?.url}`);
  });

  if (failures) {
    console.log(`\nrun-branches: ${failures} failed`);
    process.exit(1);
  }
  console.log("\nrun-branches: all passed");
}

void main();
