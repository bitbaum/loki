/**
 * Package management, phase 3: releasing a package from Loki, watching it
 * roll out, and pausing a bad release everywhere.
 *
 * Covers the parts that decide anything, with no database and no network:
 *   - which version unreleased changes make (conventional commits; under 1.0
 *     a breaking change is a minor — the same rule as dependabot.ts and the
 *     fleet sweep);
 *   - who may release (the package's owner) as a table;
 *   - what the release panel reads and when a release may start, against a
 *     fake GitHub — including that only the version shown is ever started;
 *   - the pause rows of the enforcement decision table, and a pause applied
 *     through the real sync against a fake GitHub;
 *   - the rollout per version, and the "red in N projects" flag;
 *   - the surfaces render, routes answer only the owner, the migration is
 *     additive.
 *
 * Run: npx tsx scripts/test/package-releases.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RELEASE_MESSAGES,
  ReleasePauseBody,
  StartReleaseBody,
  pauseResultMessage,
} from "@/config/package-releases";
import type { PackageUpdateSetting, UpdateDecision } from "@/config/package-updates";
import type { NewPackageUpdateRequestRow, PackageUpdateRequestRow } from "@/db/schema";
import { isBreakingBump, type PackageBump } from "@/lib/packages/dependabot";
import {
  decideReleaseAccess,
  readLastRun,
  readRelease,
  releaseBlocker,
  startRelease,
  type ReleaseState,
} from "@/lib/packages/release";
import {
  readCompare,
  readRuns,
  type ReleaseGithub,
  type ReleaseRun,
} from "@/lib/packages/release-github";
import { commitKind, nextVersion, suggestRelease } from "@/lib/packages/release-notes";
import {
  bumpsTo,
  normalizeVersion,
  pauseFor,
  type ReleasePause,
} from "@/lib/packages/release-pause";
import { buildRollout, redFlag, rolloutVersions } from "@/lib/packages/rollout";
import type { GithubPull, UpdateGithub, WriteResult } from "@/lib/packages/update-github";
import {
  ENFORCEMENT_NOTES,
  decideEnforcement,
  updateStatus,
  type CiState,
} from "@/lib/packages/update-policy";
import { syncProjectUpdates, type UpdateStore } from "@/lib/packages/updates";
import { buildUpdateCards, indexOpenUpdates, type UpdateRequestView } from "@/lib/packages/view";
import { PackageRollout } from "@/components/packages/PackageRollout";
import { ReleaseBlockerNote } from "@/components/packages/ReleaseBlockerNote";
import { ReleaseChanges, ReleaseRunLine } from "@/components/packages/ReleaseChanges";
import { PackageUpdateCard } from "@/components/packages/PackageUpdateCard";

const ROOT = join(import.meta.dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

const REF = { owner: "bitbaum", repo: "searchkit", slug: "bitbaum/searchkit" };
const NOW = new Date("2026-10-14T09:00:00Z");
const PAUSED_AT = new Date("2026-10-14T08:00:00Z");
const ok: WriteResult = { ok: true };

/** Client components that call useRouter() render under a stand-in router. */
const noop = () => undefined;
const FAKE_ROUTER = {
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};
const withRouter = (el: ReactElement) =>
  renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: FAKE_ROUTER as never }, el),
  );

// ── a fake GitHub for releases ──────────────────────────────────────────────

function fakeRelease(
  over: Partial<{
    tags: Array<{ name: string; sha: string }> | null;
    messages: string[] | null;
    total: number;
    head: string | null;
    checks: (string | null)[] | null;
    runs: { exists: boolean; runs: ReleaseRun[] } | null;
    syncPull: { number: number; url: string } | null;
    dispatch: WriteResult;
  }> = {},
): ReleaseGithub & { dispatched: Array<{ branch: string; inputs: object }>; compared: string[] } {
  const messages = over.messages === undefined ? ["fix: a typo budget off by one"] : over.messages;
  const dispatched: Array<{ branch: string; inputs: object }> = [];
  const compared: string[] = [];
  return {
    dispatched,
    compared,
    async repoAccess() {
      return { canPush: true, defaultBranch: "main" };
    },
    async tags() {
      return over.tags === undefined
        ? [
            { name: "v0.2.2", sha: "b".repeat(40) },
            { name: "v0.2.1", sha: "c".repeat(40) },
            { name: "nightly", sha: "d".repeat(40) },
          ]
        : over.tags;
    },
    async compare(_r, base, head) {
      compared.push(`${base}...${head}`);
      if (messages === null) return null;
      return {
        total: over.total ?? messages.length,
        commits: messages.map((message, i) => ({
          sha: `${i}`.repeat(40).slice(0, 40),
          message,
          url: `https://github.com/bitbaum/searchkit/commit/${i}`,
        })),
      };
    },
    async branchHead() {
      return over.head === undefined ? "a".repeat(40) : over.head;
    },
    async checkConclusions() {
      return over.checks === undefined ? ["success"] : over.checks;
    },
    async releaseRuns() {
      return over.runs === undefined ? { exists: true, runs: [] } : over.runs;
    },
    async templateSyncPull() {
      return over.syncPull ?? null;
    },
    async dispatchRelease(_r, branch, inputs) {
      dispatched.push({ branch, inputs });
      return over.dispatch ?? ok;
    },
  };
}

const run = (o: Partial<ReleaseRun>): ReleaseRun => ({
  status: "completed",
  conclusion: "success",
  url: "https://github.com/bitbaum/searchkit/actions/runs/1",
  title: "Release v0.2.3",
  createdAt: "2026-10-14T08:55:00Z",
  ...o,
});

// ── a fake GitHub + store for update pull requests ──────────────────────────

const SEARCHKIT_BUMP: PackageBump = {
  name: "searchkit",
  dependency: "searchkit",
  from: "v0.2.2",
  to: "v0.3.0",
  breaking: true,
  fleet: true,
};
const PULL: GithubPull = {
  number: 21,
  url: "https://github.com/bitbaum/site/pull/21",
  title: "chore(deps): bump searchkit from v0.2.2 to v0.3.0",
  body: "Bumps [searchkit](https://github.com/bitbaum/searchkit) from v0.2.2 to v0.3.0.",
  headSha: "e".repeat(40),
  authorLogin: "dependabot[bot]",
  authorType: "Bot",
  labels: [],
  createdAt: "2026-10-14T07:00:00Z",
  state: "open",
  merged: false,
};

function fakeUpdates(pulls: GithubPull[]): UpdateGithub & { ops: string[] } {
  const ops: string[] = [];
  return {
    ops,
    canWrite: true,
    async listOpenPulls() {
      return pulls;
    },
    async getPull(_r, n) {
      return pulls.find((p) => p.number === n) ?? null;
    },
    async checkConclusions() {
      return ["success"];
    },
    async addLabel(_r, n, l) {
      ops.push(`add ${l} #${n}`);
      return ok;
    },
    async removeLabel(_r, n, l) {
      ops.push(`remove ${l} #${n}`);
      return ok;
    },
    async comment(_r, n) {
      ops.push(`comment #${n}`);
      return ok;
    },
    async merge(_r, n) {
      ops.push(`merge #${n}`);
      return ok;
    },
  };
}

function memoryStore(rows: PackageUpdateRequestRow[] = []): UpdateStore & {
  rows: PackageUpdateRequestRow[];
} {
  return {
    rows,
    async listForProject() {
      return rows;
    },
    async listPackageKeys() {
      return [{ packageName: "searchkit", depName: "searchkit" }];
    },
    async upsert(values: NewPackageUpdateRequestRow) {
      const i = rows.findIndex((r) => r.prNumber === values.prNumber);
      const next = { ...(i >= 0 ? rows[i] : { id: `row-${values.prNumber}` }), ...values };
      if (i >= 0) rows[i] = next as PackageUpdateRequestRow;
      else rows.push(next as PackageUpdateRequestRow);
    },
    async patch(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
  };
}

const PAUSE: ReleasePause = { packageName: "searchkit", version: "0.3.0", pausedAt: PAUSED_AT };

function syncCtx(
  setting: PackageUpdateSetting,
  gh: UpdateGithub,
  store: UpdateStore,
  pauses: ReleasePause[],
) {
  return {
    userId: "u1",
    project: { id: "p1", packageUpdates: setting },
    ref: { owner: "bitbaum", repo: "site", slug: "bitbaum/site" },
    catalogueNames: new Set(["searchkit"]),
    gh,
    store,
    now: NOW,
    pauses,
  };
}

async function main() {
  console.log("package releases — which version the changes make:");

  await check("each commit is read as breaking, a feature, or a fix", () => {
    assert.equal(commitKind("feat(search): prefix while typing"), "feature");
    assert.equal(commitKind("fix: off by one"), "fix");
    assert.equal(commitKind("refactor!: drop the v1 api"), "breaking");
    assert.equal(commitKind("feat(api)!: rename score"), "breaking");
    assert.equal(commitKind("chore: tidy\n\nBREAKING CHANGE: score is now 0-1"), "breaking");
    assert.equal(commitKind("Update README"), "fix", "no type is a fix, never a feature");
    assert.equal(commitKind("feature: not a conventional type"), "fix");
  });

  await check("1.0 and up: breaking → major, feature → minor, else patch", () => {
    const s = (msgs: string[]) =>
      suggestRelease(
        "1.4.2",
        msgs.map((message) => ({ message })),
      );
    assert.deepEqual(
      [s(["fix: a"])?.version, s(["fix: a", "feat: b"])?.version, s(["feat: b", "x!: c"])?.version],
      ["1.4.3", "1.5.0", "2.0.0"],
    );
    assert.equal(s(["feat: b"])?.breaking, false);
    assert.equal(s(["x!: c"])?.breaking, true);
  });

  await check("under 1.0: breaking → minor, a feature is only a patch", () => {
    const s = (msgs: string[]) =>
      suggestRelease(
        "0.2.2",
        msgs.map((message) => ({ message })),
      );
    assert.deepEqual(
      [s(["fix: a"])?.version, s(["feat: b"])?.version, s(["feat!: c"])?.version],
      ["0.2.3", "0.2.3", "0.3.0"],
    );
    assert.equal(s(["feat!: c"])?.bump, "minor");
  });

  await check("the suggestion and the update rule agree on what is breaking", () => {
    for (const [cur, msgs] of [
      ["0.2.2", ["feat: x"]],
      ["0.2.2", ["fix!: x"]],
      ["1.2.3", ["feat: x"]],
      ["1.2.3", ["refactor!: x"]],
    ] as const) {
      const s = suggestRelease(
        cur,
        msgs.map((message) => ({ message })),
      )!;
      assert.equal(s.breaking, isBreakingBump(cur, s.version), `${cur} ${msgs}`);
      assert.equal(s.breaking, s.kind === "breaking", `${cur} ${msgs}: kind`);
    }
  });

  await check("nothing changed, or no version to count from → no suggestion", () => {
    assert.equal(suggestRelease("0.2.2", []), null);
    assert.equal(suggestRelease(null, [{ message: "fix: a" }]), null);
    assert.equal(suggestRelease("nightly", [{ message: "fix: a" }]), null);
    assert.equal(
      nextVersion("1.0.0-rc.2", "minor"),
      "1.0.0",
      "a pre-release is released as itself",
    );
  });

  console.log("package releases — who may release:");

  await check("the owner table", () => {
    const base = { hasRepo: true, viewerId: "me", hasToken: true, canPush: true };
    const cases: Array<[Partial<Parameters<typeof decideReleaseAccess>[0]>, string]> = [
      [{ hasRepo: false, projectOwnerIds: [] }, RELEASE_MESSAGES.noRepo],
      // A project is the package repo and it is someone else's: no, whatever GitHub says.
      [{ projectOwnerIds: ["them"] }, RELEASE_MESSAGES.notOwner],
      [{ projectOwnerIds: ["me"], hasToken: false }, RELEASE_MESSAGES.connectGithub],
      [{ projectOwnerIds: ["me"], canPush: false }, RELEASE_MESSAGES.cannotPush],
      [{ projectOwnerIds: ["me"], canPush: null }, RELEASE_MESSAGES.unreadable],
      [{ projectOwnerIds: [], canPush: false }, RELEASE_MESSAGES.cannotPush],
      [{ projectOwnerIds: ["me"] }, "project"],
      [{ projectOwnerIds: ["me", "them"] }, "project"],
      // No project is the package repo: GitHub's push permission decides.
      [{ projectOwnerIds: [] }, "github"],
    ];
    for (const [over, want] of cases) {
      const got = decideReleaseAccess({ ...base, projectOwnerIds: [], ...over });
      assert.equal(got.ok ? got.via : got.reason, want, JSON.stringify(over));
    }
    const connect = decideReleaseAccess({ ...base, projectOwnerIds: [], hasToken: false });
    assert.equal(!connect.ok && connect.connectGithub, true, "no token → offer to connect GitHub");
  });

  console.log("package releases — the release panel against a fake GitHub:");

  await check("reads changes since the highest version tag, newest first, capped", async () => {
    const gh = fakeRelease({
      messages: ["fix: one", "feat: two", "docs: three"],
      total: 3,
    });
    const s = await readRelease(gh, REF, "main", 2);
    assert.deepEqual(gh.compared, ["v0.2.2...main"], "a non-version tag is not a release");
    assert.equal(s.current, "0.2.2");
    assert.equal(s.unreleased?.total, 3);
    assert.deepEqual(
      s.unreleased?.changes.map((c) => c.title),
      ["docs: three", "feat: two"],
    );
    assert.equal(s.suggestion?.version, "0.2.3");
    assert.equal(s.main, "green");
    assert.equal(releaseBlocker(s), null);
  });

  await check("every reason not to release, in the order a person fixes them", async () => {
    const blocker = async (o: Parameters<typeof fakeRelease>[0]) =>
      releaseBlocker(await readRelease(fakeRelease(o), REF, "main", 8));
    assert.equal(await blocker({ runs: { exists: false, runs: [] } }), RELEASE_MESSAGES.noWorkflow);
    assert.equal(await blocker({ runs: null }), RELEASE_MESSAGES.unreadable);
    assert.equal(
      await blocker({
        runs: { exists: true, runs: [run({ status: "in_progress", conclusion: null })] },
      }),
      RELEASE_MESSAGES.running,
    );
    assert.equal(await blocker({ tags: [] }), RELEASE_MESSAGES.noTag);
    assert.equal(await blocker({ messages: null }), RELEASE_MESSAGES.unreadable);
    assert.equal(await blocker({ messages: [] }), RELEASE_MESSAGES.nothingToRelease);
    assert.equal(await blocker({ checks: ["failure"] }), RELEASE_MESSAGES.mainRed);
    assert.equal(await blocker({ checks: [null] }), RELEASE_MESSAGES.mainRunning);
    assert.equal(await blocker({ checks: [] }), RELEASE_MESSAGES.mainUnknown);
  });

  await check(
    "a repository without release.yml is pointed at the fleet's pull request",
    async () => {
      const s = await readRelease(
        fakeRelease({
          runs: { exists: false, runs: [] },
          syncPull: { number: 4, url: "https://github.com/bitbaum/searchkit/pull/4" },
        }),
        REF,
        "main",
        8,
      );
      assert.equal(s.workflow, "missing");
      assert.equal(s.syncPull?.number, 4);
      const html = renderToStaticMarkup(
        createElement(ReleaseBlockerNote, { blocker: releaseBlocker(s)!, release: s }),
      );
      assert.match(html, /pull\/4/);
      const none = renderToStaticMarkup(
        createElement(ReleaseBlockerNote, {
          blocker: RELEASE_MESSAGES.noWorkflow,
          release: { ...s, syncPull: null },
        }),
      );
      assert.match(none, /package-repos\.yml/, "no pull request yet: the sync is one tap away");
      assert.match(none, /templates\/package\/\.github\/workflows\/release\.yml/);
    },
  );

  await check("starts exactly the version shown — and nothing when it moved", async () => {
    const gh = fakeRelease({ messages: ["feat!: rename"] });
    const started = await startRelease(gh, REF, "main", { version: "0.3.0", bump: "minor" });
    assert.equal(started.ok, true);
    assert.deepEqual(gh.dispatched, [
      { branch: "main", inputs: { bump: "minor", version: "0.3.0" } },
    ]);

    const moved = fakeRelease({ messages: ["fix: a"] });
    const stale = await startRelease(moved, REF, "main", { version: "0.3.0", bump: "minor" });
    assert.deepEqual(stale, { ok: false, status: 409, message: RELEASE_MESSAGES.stale });
    assert.equal(moved.dispatched.length, 0);

    const red = fakeRelease({ messages: ["fix: a"], checks: ["failure"] });
    const refused = await startRelease(red, REF, "main", { version: "0.2.3", bump: "patch" });
    assert.equal(refused.ok ? "" : refused.message, RELEASE_MESSAGES.mainRed);
    assert.equal(red.dispatched.length, 0, "a red main starts nothing");

    const denied = fakeRelease({ dispatch: { ok: false, status: 403, message: "nope" } });
    const out = await startRelease(denied, REF, "main", { version: "0.2.3", bump: "patch" });
    assert.equal(out.ok ? "" : out.message, RELEASE_MESSAGES.cannotPush);
  });

  await check("the last run reads as running, released (tagged or not yet) or failed", () => {
    assert.equal(
      readLastRun([run({ status: "queued", conclusion: null })], "0.2.2")?.phase,
      "running",
    );
    const done = readLastRun([run({})], "0.2.3")!;
    assert.deepEqual([done.phase, done.version, done.tagged], ["released", "0.2.3", true]);
    assert.equal(readLastRun([run({})], "0.2.2")?.tagged, false);
    assert.equal(readLastRun([run({ conclusion: "failure" })], "0.2.2")?.phase, "failed");
    assert.equal(readLastRun([], "0.2.2"), null);
    const html = renderToStaticMarkup(
      createElement(ReleaseRunLine, { run: readLastRun([run({ conclusion: "failure" })], null)! }),
    );
    assert.match(html, /failed/);
    assert.match(html, /See what happened/);
  });

  await check("GitHub's compare and runs JSON are read, junk is dropped", () => {
    const c = readCompare({
      total_commits: 2,
      commits: [
        { sha: "a", html_url: "u", commit: { message: "fix: a" } },
        { sha: 1, commit: {} },
      ],
    });
    assert.deepEqual(c, { total: 2, commits: [{ sha: "a", message: "fix: a", url: "u" }] });
    assert.equal(readCompare({ message: "Not Found" }), null);
    assert.deepEqual(
      readRuns({
        workflow_runs: [
          {
            status: "completed",
            conclusion: "success",
            html_url: "u",
            display_title: "Release v1.0.0",
          },
          { status: 3 },
        ],
      }).map((r) => r.title),
      ["Release v1.0.0"],
    );
  });

  await check("the changes list links each change and the rest", async () => {
    const s = await readRelease(
      fakeRelease({ messages: ["fix: a", "feat!: b"], total: 9 }),
      REF,
      "main",
      2,
    );
    const html = renderToStaticMarkup(createElement(ReleaseChanges, { release: s }));
    assert.match(html, /breaking/);
    assert.match(html, /and 7 more/);
    assert.match(html, /compare\/v0\.2\.2\.\.\.main/);
  });

  console.log("package releases — pausing a release (the decision table):");

  type Row = [
    string,
    Partial<Parameters<typeof decideEnforcement>[0]>,
    {
      label: string;
      state: string;
      merge?: boolean;
      heldByLoki: boolean;
      decision?: UpdateDecision | null;
    },
  ];
  const base = {
    setting: "auto" as PackageUpdateSetting,
    breaking: false,
    labels: [] as string[],
    heldByLoki: false,
    decision: null as UpdateDecision | null,
    ciState: "green" as CiState,
  };
  const TABLE: Row[] = [
    [
      "paused, auto, routine: Loki holds it",
      { paused: true },
      { label: "add", state: "held", heldByLoki: true },
    ],
    [
      "paused, ask: held (already)",
      { paused: true, setting: "ask", labels: ["hold"], heldByLoki: true },
      { label: "none", state: "held", heldByLoki: true },
    ],
    [
      "paused, approved breaking & green: held, not merged, approval kept",
      { paused: true, breaking: true, decision: "update", labels: ["hold"], heldByLoki: true },
      { label: "none", state: "held", merge: false, heldByLoki: true, decision: "update" },
    ],
    [
      "paused beside a person's `hold`: theirs, untouched — Loki never claims it",
      { paused: true, labels: ["hold"], heldByLoki: false },
      { label: "none", state: "held", heldByLoki: false },
    ],
    [
      "resumed, auto: Loki takes its pause hold off",
      { paused: false, labels: ["hold"], heldByLoki: true },
      { label: "remove", state: "open", heldByLoki: false },
    ],
    [
      "resumed, ask: the setting still holds it",
      { paused: false, setting: "ask", labels: ["hold"], heldByLoki: true },
      { label: "none", state: "held", heldByLoki: true },
    ],
    [
      "resumed, approved breaking & green: now it merges",
      { paused: false, breaking: true, decision: "update", labels: ["hold"], heldByLoki: true },
      { label: "remove", state: "approved", merge: true, heldByLoki: false },
    ],
    [
      "a person takes the pause hold off on GitHub: Loki stands aside",
      { paused: true, labels: [], heldByLoki: true, decision: "update" },
      { label: "none", state: "open", heldByLoki: false, decision: "released" },
    ],
    [
      "released on GitHub BEFORE the pause: the pause still holds it",
      { paused: true, decision: "released", decidedBeforePause: true },
      { label: "add", state: "held", heldByLoki: true, decision: "released" },
    ],
    [
      "released DURING the pause: left alone",
      { paused: true, decision: "released", decidedBeforePause: false },
      { label: "none", state: "open", heldByLoki: false },
    ],
    [
      "after the pause on an old release: its pause hold comes off",
      { paused: false, decision: "released", labels: ["hold"], heldByLoki: true },
      { label: "remove", state: "open", heldByLoki: false, decision: "released" },
    ],
  ];

  await check(`pause: ${TABLE.length} rows`, () => {
    for (const [name, over, want] of TABLE) {
      const got = decideEnforcement({ ...base, ...over });
      assert.equal(got.label, want.label, `${name}: label`);
      assert.equal(got.state, want.state, `${name}: state`);
      assert.equal(got.merge, want.merge ?? false, `${name}: merge`);
      assert.equal(got.heldByLoki, want.heldByLoki, `${name}: heldByLoki`);
      if ("decision" in want) assert.equal(got.decision, want.decision, `${name}: decision`);
    }
  });

  await check("a pause says so; a release seen during it is dated now", () => {
    assert.equal(decideEnforcement({ ...base, paused: true }).note, ENFORCEMENT_NOTES.paused);
    const seen = decideEnforcement({
      ...base,
      paused: true,
      heldByLoki: true,
      decision: "released",
      decidedBeforePause: true,
    });
    assert.equal(
      seen.decidedNow,
      true,
      "a second release must not read as one from before the pause",
    );
    assert.equal(decideEnforcement(base).decidedNow, false);
  });

  await check("which updates a pause covers: that package, that exact version", () => {
    const later = { ...SEARCHKIT_BUMP, to: "v0.3.1" };
    const other = { ...SEARCHKIT_BUMP, name: "listkit" };
    assert.equal(pauseFor([SEARCHKIT_BUMP], [PAUSE]), PAUSE);
    assert.equal(pauseFor([later], [PAUSE]), null, "a fix released after it is not paused");
    assert.equal(pauseFor([other], [PAUSE]), null);
    assert.equal(pauseFor([{ ...SEARCHKIT_BUMP, fleet: false }], [PAUSE]), null);
    assert.equal(bumpsTo([{ ...SEARCHKIT_BUMP, to: "`0.3.0`" }], "searchkit", "0.3.0"), true);
    assert.equal(normalizeVersion(" v0.3.0 "), "0.3.0");
    assert.equal(ReleasePauseBody.parse({ version: "v0.3.0", paused: true }).version, "0.3.0");
    assert.equal(ReleasePauseBody.safeParse({ version: "latest", paused: true }).success, false);
    assert.equal(StartReleaseBody.safeParse({ version: "0.3", bump: "minor" }).success, false);
    assert.equal(StartReleaseBody.safeParse({ version: "0.3.0", bump: "huge" }).success, false);
  });

  await check("pause → resume through the real sync, against a fake GitHub", async () => {
    const store = memoryStore();
    // auto + non-breaking would merge on its own: the pause holds it.
    const routine = {
      ...PULL,
      title: "chore(deps): bump searchkit from v0.3.0 to v0.3.1",
      body: null,
    };
    const pauseRoutine: ReleasePause = { ...PAUSE, version: "0.3.1" };
    const gh1 = fakeUpdates([routine]);
    await syncProjectUpdates(syncCtx("auto", gh1, store, [pauseRoutine]));
    assert.deepEqual(gh1.ops, ["add hold #21"]);
    assert.equal(store.rows[0]!.state, "held");
    assert.equal(store.rows[0]!.detail, ENFORCEMENT_NOTES.paused);

    // Still paused: nothing more to do.
    const gh2 = fakeUpdates([{ ...routine, labels: ["hold"] }]);
    await syncProjectUpdates(syncCtx("auto", gh2, store, [pauseRoutine]));
    assert.deepEqual(gh2.ops, []);

    // Resumed: only Loki's own hold comes off, and the sweep may merge it.
    const gh3 = fakeUpdates([{ ...routine, labels: ["hold"] }]);
    await syncProjectUpdates(syncCtx("auto", gh3, store, []));
    assert.deepEqual(gh3.ops, ["remove hold #21"]);
    assert.equal(store.rows[0]!.state, "open");
  });

  await check("a person's own hold survives a pause and its resume", async () => {
    const store = memoryStore();
    const theirs = {
      ...PULL,
      title: "chore(deps): bump searchkit from v0.3.0 to v0.3.1",
      body: null,
      labels: ["hold"],
    };
    const pause: ReleasePause = { ...PAUSE, version: "0.3.1" };
    const gh1 = fakeUpdates([theirs]);
    await syncProjectUpdates(syncCtx("auto", gh1, store, [pause]));
    const gh2 = fakeUpdates([theirs]);
    await syncProjectUpdates(syncCtx("auto", gh2, store, []));
    assert.deepEqual([...gh1.ops, ...gh2.ops], [], "never added, never removed");
    assert.equal(store.rows[0]!.state, "held");
  });

  console.log("package releases — rollout:");

  const dep = (projectId: string, version: string | null) => ({
    projectId,
    projectName: `Project ${projectId}`,
    version,
    href: `/projects/${projectId}`,
  });
  const req = (
    projectId: string,
    prNumber: number,
    to: string,
    o: Partial<UpdateRequestView> = {},
  ) => ({
    projectId,
    prNumber,
    prUrl: `https://github.com/bitbaum/${projectId}/pull/${prNumber}`,
    packages: [{ ...SEARCHKIT_BUMP, to }],
    state: "open" as const,
    decision: null,
    ciState: "pending" as CiState,
    ...o,
  });

  await check("each project lands in one bucket per version", () => {
    const rows = buildRollout({
      packageName: "searchkit",
      latest: "0.3.0",
      dependents: [
        dep("a", "0.3.0"),
        dep("b", "0.2.2"),
        dep("c", "0.2.2"),
        dep("d", "0.2.2"),
        dep("e", null),
        dep("f", "0.2.1"),
      ],
      requests: [
        req("b", 5, "v0.3.0", { ciState: "red" }),
        req("c", 6, "v0.3.0", { ciState: "green" }),
        req("d", 7, "v0.3.0", { state: "held" }),
      ],
      pauses: [],
    });
    assert.deepEqual(
      rows.map((r) => r.version),
      ["0.3.0", "0.2.2", "0.2.1"],
    );
    const v030 = rows[0]!;
    assert.equal(v030.latest, true);
    assert.deepEqual(
      [
        v030.counts.on,
        v030.counts.red,
        v030.counts.ready,
        v030.counts.held,
        v030.counts.behind,
        v030.counts.unknown,
      ],
      [1, 1, 1, 1, 1, 1],
    );
    assert.equal(redFlag(v030), "Red in 1 project — its tests fail on v0.3.0");
    assert.equal(v030.red[0]!.prUrl, "https://github.com/bitbaum/b/pull/5");
    const v022 = rows[1]!;
    assert.deepEqual([v022.counts.on, v022.counts.newer, v022.counts.behind], [3, 1, 1]);
    assert.equal(redFlag(v022), null);
  });

  await check(
    "a paused version is marked, its updates read as paused, and it never drops off",
    () => {
      const rows = buildRollout({
        packageName: "searchkit",
        latest: "0.3.0",
        dependents: [dep("b", "0.2.2")],
        requests: [req("b", 5, "0.3.0", { state: "held" })],
        pauses: [PAUSE],
      });
      assert.equal(rows[0]!.pause, PAUSE);
      assert.equal(rows[0]!.counts.paused, 1);
      assert.deepEqual(
        rolloutVersions("0.9.0", ["0.8.0", "0.7.0", "0.6.0", "0.5.0", "0.4.0", "0.3.0"], ["0.1.0"]),
        ["0.9.0", "0.8.0", "0.7.0", "0.6.0", "0.5.0", "0.1.0"],
      );
    },
  );

  await check(
    "the rollout renders the flag with links, and pause controls only for the owner",
    () => {
      const rows = buildRollout({
        packageName: "searchkit",
        latest: "0.3.0",
        dependents: [dep("b", "0.2.2"), dep("c", "0.2.2")],
        requests: [
          req("b", 5, "0.3.0", { ciState: "red" }),
          req("c", 6, "0.3.0", { ciState: "red" }),
        ],
        pauses: [PAUSE],
      });
      const owner = withRouter(
        createElement(PackageRollout, { slug: "searchkit", rows, owner: true }),
      );
      assert.match(owner, /Red in 2 projects — their tests fail on v0\.3\.0/);
      assert.match(owner, /bitbaum\/c\/pull\/6/);
      assert.match(owner, /Paused by the package owner/);
      assert.match(owner, /Resume v0\.3\.0/);
      const viewer = withRouter(
        createElement(PackageRollout, { slug: "searchkit", rows, owner: false }),
      );
      assert.doesNotMatch(viewer, /Resume|Pause v/);
    },
  );

  await check("cards and update lines say 'paused by the package owner'", () => {
    assert.equal(
      updateStatus({ state: "held", decision: null, ciState: "green" }, "ask", true).label,
      "paused by the package owner",
    );
    assert.equal(
      updateStatus({ state: "merged", decision: null, ciState: "green" }, "ask", true).label,
      "merged",
    );
    const view = {
      ...req("b", 5, "0.3.0", { state: "held" }),
      detail: ENFORCEMENT_NOTES.paused,
      packageUpdates: "ask",
      paused: true,
    } as UpdateRequestView;
    assert.equal(indexOpenUpdates([view]).get("b|searchkit")?.paused, true);
    const [card] = buildUpdateCards(
      [{ ...view, id: "r1", projectName: "Site", entityProjectId: null, snoozedUntil: null }],
      NOW.getTime(),
    );
    assert.equal(card?.paused, true);
    const html = withRouter(createElement(PackageUpdateCard, { update: card! }));
    assert.match(html, /Paused by the package owner/);
  });

  await check("pause results say what happened in one sentence", () => {
    assert.equal(
      pauseResultMessage(true, "0.3.0", { projects: 3, held: 3, failed: 0 }),
      "Paused v0.3.0. Held in 3 of 3 projects with an update to it open.",
    );
    assert.match(
      pauseResultMessage(true, "0.3.0", { projects: 0, held: 0, failed: 0 }),
      /any that opens is held/,
    );
    assert.match(
      pauseResultMessage(false, "0.3.0", { projects: 2, held: 0, failed: 1 }),
      /within 15 minutes/,
    );
  });

  console.log("package releases — routes, page, migration:");

  await check("both routes answer only the signed-in owner, rate-limited, body validated", () => {
    for (const p of [
      "src/app/api/packages/[slug]/release/route.ts",
      "src/app/api/packages/[slug]/pause/route.ts",
    ]) {
      const route = src(p);
      assert.match(route, /getApiUserId\(\)/, p);
      assert.match(route, /jsonError\("Unauthorized", 401\)/, p);
      assert.match(route, /checkRateLimit\(/, p);
      assert.match(route, /readJsonBody\(req, (StartReleaseBody|ReleasePauseBody)\)/, p);
      assert.match(route, /resolveReleaseAccess\(userId, pkg\)/, p);
      assert.match(route, /jsonError\(access\.reason, 403/, p);
    }
  });

  await check("the package page carries the release panel and the rollout", () => {
    const page = src("src/app/(app)/packages/[slug]/page.tsx");
    assert.match(page, /<PackageRelease slug=\{pkg\.slug\} \/>/);
    assert.match(page, /<PackageRollout slug=\{pkg\.slug\} rows=\{rollout\} owner=\{owner\} \/>/);
  });

  await check("the pause table's migration is additive", () => {
    const sql = src("drizzle/0101_package_release_pauses.sql");
    assert.match(sql, /CREATE TABLE "package_release_pauses"/);
    assert.doesNotMatch(sql, /\bDROP\b|ALTER TABLE "(?!package_release_pauses)/);
  });

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ package releases");
}

void main();
