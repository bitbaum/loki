/**
 * Whose pull request is it: the rules after the review of #1643 (2026-11-12).
 *
 * - The fix ledger decided "this run's" by time alone, and on that basis could
 *   merge (auto-ship) or put back into draft a pull request somebody opened on
 *   another branch while the run was open, if the handoff named it.
 * - The evidence window had no end, so an earlier run sharing a branch with a
 *   later one claimed the later run's pull request.
 * - Only the ten newest pull requests were looked at; a busy repository pushed
 *   the run's own one off that page.
 * - Legal branch names with `#` or `+` were dropped.
 * - Evidence recorded before it carried its branch was never checked again.
 *
 * Run: npx tsx scripts/test/run-evidence-ownership.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { fetchPrHeadRef, findRepoWorkEvidence } from "@/lib/github-evidence";
import { prOwnership } from "@/lib/feedback/auto-ship";
import {
  RUN_EVIDENCE_AFTER_FINISH_MS,
  cleanBranchName,
  runBranches,
  runEvidenceUntilMs,
  runReportedBranches,
} from "@/lib/run-branches";
import { normalizeRepoWorkEvidence } from "@/lib/repo-evidence";
import { openedDuringRun } from "@/lib/salvage-plan";

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
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const RUN = "70d1a78d-1111-4222-8333-444444444444";
const STARTED = "2026-11-12T03:50:00Z";
const GIT_URL = "https://github.com/bitbaum/loki";
const own = runBranches({ id: RUN });
const fresh = { own, reported: true };
const oldRunner = { own, reported: false };

type Pull = { number: number; head: string; created_at: string };
/** GitHub, answering the per-branch pull request query as GitHub does. */
function github(pulls: Pull[], log: string[] = []) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    log.push(url);
    if (url.includes("/pulls?")) {
      const head = decodeURIComponent(url.match(/head=([^&]+)/)?.[1] ?? "").replace(/^[^:]+:/, "");
      const rows = pulls
        .filter((p) => !head || p.head === head)
        .map((p) => ({
          html_url: `${GIT_URL}/pull/${p.number}`,
          title: `pull ${p.number}`,
          created_at: p.created_at,
          user: { type: "User", login: "cato" },
          head: { ref: p.head },
        }));
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    const one = url.match(/\/pulls\/(\d+)$/);
    if (one) {
      const p = pulls.find((x) => x.number === Number(one[1]));
      return p
        ? new Response(JSON.stringify({ head: { ref: p.head } }), { status: 200 })
        : new Response("{}", { status: 404 });
    }
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
}

async function main() {
  // ── the ledger ──────────────────────────────────────────────────────────
  await check(
    "the incident: a person's pull request opened during the run is not the run's",
    () => {
      const got = prOwnership({
        prCreatedAt: "2026-11-12T03:58:00Z",
        headRef: "ops/grubenv-repair",
        runStartedAt: STARTED,
        runBranches: fresh,
        namedInHandoff: false,
      });
      assert(!got.runs && !got.mayAct, JSON.stringify(got));
    },
  );

  await check("a handoff naming somebody else's pull request never gets it merged", () => {
    for (const branches of [fresh, oldRunner]) {
      const got = prOwnership({
        prCreatedAt: "2026-11-12T04:05:00Z",
        headRef: "feature/x",
        runStartedAt: STARTED,
        runBranches: branches,
        namedInHandoff: true,
      });
      assert(!got.mayAct, `may merge with reported=${branches.reported}`);
    }
  });

  await check("a runner that reports branches: the named pull request must be on them", () => {
    const got = prOwnership({
      prCreatedAt: "2026-11-12T04:05:00Z",
      headRef: "feature/x",
      runStartedAt: STARTED,
      runBranches: fresh,
      namedInHandoff: true,
    });
    assert(!got.runs, "reported as the run's");
  });

  await check(
    "an older runner: the pull request its handoff names is still shown as its own",
    () => {
      const got = prOwnership({
        prCreatedAt: "2026-11-12T04:05:00Z",
        headRef: "fix/agent-named",
        runStartedAt: STARTED,
        runBranches: oldRunner,
        namedInHandoff: true,
      });
      assert(got.runs && !got.mayAct, JSON.stringify(got));
    },
  );

  await check("the run's own pull request is its own and may be shipped", () => {
    const got = prOwnership({
      prCreatedAt: "2026-11-12T04:05:00Z",
      headRef: "loki/run-70d1a78d",
      runStartedAt: STARTED,
      runBranches: fresh,
      namedInHandoff: false,
    });
    assert(got.runs && got.mayAct, JSON.stringify(got));
  });

  await check("a pull request older than the run is never its own, even on its branch", () => {
    const got = prOwnership({
      prCreatedAt: "2026-11-12T03:00:00Z",
      headRef: "loki/run-70d1a78d",
      runStartedAt: STARTED,
      runBranches: fresh,
      namedInHandoff: true,
    });
    assert(!got.runs && !got.mayAct, JSON.stringify(got));
  });

  await check(
    "the ledger's two callers pass the run's branches, and it acts only on mayAct",
    () => {
      for (const rel of ["src/lib/run-follow.ts", "src/lib/feedback/attach-work.ts"]) {
        assert(
          /runBranches: \{ own: runBranches\(run\), reported: runReportedBranches\(run\) \}/.test(
            read(rel),
          ),
          `${rel} does not pass them`,
        );
      }
      const src = read("src/lib/feedback/fix-shipping-refresh.ts");
      assert(/fromOurDispatch: owner\.mayAct,/.test(src), "auto-ship decides by time");
      assert(/pr\.nodeId &&\s*owner\.mayAct/.test(src), "keepDraft decides by time");
      assert(/else if \(!owner\.runs\) \{/.test(src), "display decides by time");
    },
  );

  // ── the evidence finder ─────────────────────────────────────────────────
  await check("the run's own pull request is found however many others are newer", async () => {
    const pulls: Pull[] = Array.from({ length: 14 }, (_, i) => ({
      number: 1700 + i,
      head: `person/branch-${i}`,
      created_at: `2026-11-12T04:${String(10 + i).padStart(2, "0")}:00Z`,
    }));
    pulls.push({ number: 1650, head: "loki/run-70d1a78d", created_at: "2026-11-12T03:55:00Z" });
    const log: string[] = [];
    github(pulls, log);
    const got = await findRepoWorkEvidence(GIT_URL, "t", Date.parse(STARTED), own);
    assert(got?.url.endsWith("/pull/1650") === true, `got ${got?.url}`);
    assert(got?.branch === "loki/run-70d1a78d", "the branch is not recorded");
    assert(
      log.every((u) => !u.includes("/pulls?") || u.includes("head=")),
      "asked without head",
    );
  });

  await check(
    "a finished run does not claim a pull request opened long after it ended",
    async () => {
      // Run A finished at 04:00 with nothing on GitHub; the next run of the
      // same session worked on A's branch and opened #1660 at 05:00.
      github([{ number: 1660, head: "loki/run-70d1a78d", created_at: "2026-11-12T05:00:00Z" }]);
      const until = runEvidenceUntilMs({ finishedAt: "2026-11-12T04:00:00Z" });
      assert(
        until === Date.parse("2026-11-12T04:00:00Z") + RUN_EVIDENCE_AFTER_FINISH_MS,
        `${until}`,
      );
      const got = await findRepoWorkEvidence(GIT_URL, "t", Date.parse(STARTED), own, until);
      assert(got === null, `claimed ${got?.url}`);
      const open = await findRepoWorkEvidence(GIT_URL, "t", Date.parse(STARTED), own, null);
      assert(open?.url.endsWith("/pull/1660") === true, "an open run lost its own pull request");
    },
  );

  await check("a pull request pushed just after the handoff still counts", async () => {
    github([{ number: 1661, head: "loki/run-70d1a78d", created_at: "2026-11-12T04:05:00Z" }]);
    const until = runEvidenceUntilMs({ finishedAt: new Date("2026-11-12T04:00:00Z") });
    const got = await findRepoWorkEvidence(GIT_URL, "t", Date.parse(STARTED), own, until);
    assert(got?.url.endsWith("/pull/1661") === true, `got ${got?.url}`);
  });

  // ── branch names and old evidence ───────────────────────────────────────
  await check("legal branch names are kept, illegal ones are not", () => {
    for (const ok of ["feature/#412-header", "fix+a", "user@host/x", "release/1.2.3", "a_b-c"])
      assert(cleanBranchName(ok) === ok, `${ok} dropped`);
    for (const bad of [
      "a b",
      "a..b",
      "a@{1}",
      "-x",
      "x.",
      "x.lock",
      "a/.b",
      "a//b",
      "x~1",
      "x^",
      "x:y",
      "HEAD",
      "@",
    ])
      assert(cleanBranchName(bad) === null, `${bad} kept`);
  });

  await check("whether a runner reported branches at all is known", () => {
    assert(!runReportedBranches({ payload: {} }), "no branches");
    assert(runReportedBranches({ payload: { branches: ["fix/x"] } }), "one branch");
  });

  await check("evidence keeps its branch, and old evidence is recognised as old", () => {
    const withBranch = normalizeRepoWorkEvidence({
      kind: "pr",
      url: `${GIT_URL}/pull/1650`,
      title: "x",
      atMs: 1,
      branch: "loki/run-70d1a78d",
    });
    assert(withBranch?.branch === "loki/run-70d1a78d", "branch dropped");
    const old = normalizeRepoWorkEvidence({
      kind: "pr",
      url: `${GIT_URL}/pull/1636`,
      title: "x",
      atMs: 1,
    });
    assert(old !== null && old.branch === undefined, "old evidence misread");
  });

  await check("an old pull request's head branch can be read back from GitHub", async () => {
    github([{ number: 1636, head: "ops/grubenv-repair", created_at: "2026-11-12T03:58:00Z" }]);
    assert((await fetchPrHeadRef(`${GIT_URL}/pull/1636`, "t")) === "ops/grubenv-repair", "head");
    assert((await fetchPrHeadRef(`${GIT_URL}/pull/9`, "t")) === undefined, "unknown is not null");
  });

  await check("old evidence is checked before it is trusted, and removed when foreign", () => {
    const src = read("src/lib/run-evidence-live.ts");
    assert(
      /if \(known\?\.branch\) return refBelongsToRun\(known\.branch, own\) \? known : null;/.test(
        src,
      ),
      "recorded branch not checked",
    );
    assert(
      /const head = await fetchPrHeadRef\(known\.url, token\);/.test(src),
      "old evidence not checked",
    );
    assert(/await replaceRunEvidence\(run\.id, userId, null\)/.test(src), "foreign evidence kept");
    const track = read("src/lib/run-track-load.ts");
    assert(
      /evidence = await findLiveRunEvidence\(userId, run, gitUrl, now\);/.test(track),
      "track",
    );
    assert(
      /if \(evidence && !evidence\.branch && !ownerView\) \{/.test(track),
      "other views trust old evidence",
    );
  });

  // ── the runner's own "shipped" close ───────────────────────────────────
  // A session carrying on from an earlier run sits on that run's branch; the
  // runner took that branch's pull request as the new run's, closed the run
  // Done with it, and stopped the shared session.
  await check(
    "the runner closes a run as shipped only with a pull request opened during it",
    () => {
      const began = Date.parse("2026-11-12T03:50:00Z");
      assert(!openedDuringRun("2026-11-12T03:10:00Z", began), "an earlier run's pull request");
      assert(openedDuringRun("2026-11-12T03:55:00Z", began), "the run's own");
      assert(openedDuringRun("2026-11-12T03:49:30Z", began), "a little clock difference");
      assert(!openedDuringRun(undefined, began), "unknown counts as earlier");
      const src = read("desktop/src/main/run-progress.ts");
      assert(
        /findShippedPr\(t\.tab, t\.dir, t\.startedAt\)/.test(src),
        "the run's start is not passed",
      );
    },
  );

  await check("the runner stops the agent only when the server closed this run", () => {
    const src = read("desktop/src/main/run-progress.ts");
    assert(
      /if \(answer\?\.closed === true\) \{\s*await terminatePty/.test(src),
      "the session is stopped whatever the server answered",
    );
    const route = read("src/app/api/control/runs/[id]/progress/route.ts");
    assert(/closed: closed !== null/.test(route), "the server does not say it closed the run");
  });

  if (failures) {
    console.log(`\nrun-evidence-ownership: ${failures} failed`);
    process.exit(1);
  }
  console.log("\nrun-evidence-ownership: all passed");
}

void main();
