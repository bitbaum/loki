/**
 * Package management, phase 2: how updates reach a project.
 *
 * Covers the parts that decide anything, with no database and no network:
 *   - reading Dependabot pull requests (titles and bodies shaped like the real
 *     ones: a single bump, a grouped bump, an npm alias, a git tag, a git sha);
 *   - what counts as breaking (a major, or a minor under 1.0 — the fleet
 *     sweep's own rule);
 *   - the enforcement decision table: setting × breaking × whose hold it is;
 *   - what a decision on Approvals does on GitHub, against a fake client;
 *   - the setting's validation, and that its routes answer only the owner.
 *
 * Run: npx tsx scripts/test/package-updates.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PACKAGE_UPDATE_SETTINGS,
  PackageUpdateSettingBody,
  UPDATE_SYNC_SCHEDULE,
  UpdateDecisionBody,
  readPackageUpdateSetting,
  type PackageUpdateSetting,
  type UpdateDecision,
} from "@/config/package-updates";
import {
  anyBreaking,
  ignoreCommands,
  isBreakingBump,
  isGroupedTitle,
  matchBumps,
  parseDependabotBumps,
} from "@/lib/packages/dependabot";
import {
  ENFORCEMENT_NOTES,
  ciStateFrom,
  decideEnforcement,
  needsDecision,
  updateStatus,
  type CiState,
} from "@/lib/packages/update-policy";
import {
  readPull,
  type GithubPull,
  type UpdateGithub,
  type WriteResult,
} from "@/lib/packages/update-github";
import {
  UPDATE_MESSAGES,
  applyUpdateDecision,
  syncProjectUpdates,
  type UpdateContext,
  type UpdateStore,
} from "@/lib/packages/updates";
import { buildUpdateCards, indexOpenUpdates, versionLabel } from "@/lib/packages/view";
import { OpenUpdateLine } from "@/components/packages/OpenUpdateLine";
import type { NewPackageUpdateRequestRow, PackageUpdateRequestRow } from "@/db/schema";

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

// ── fixtures: Dependabot as it writes ───────────────────────────────────────

const SINGLE = {
  title: "chore(deps): bump @bitbaum/chatkit from 0.3.1 to 0.3.2",
  body: [
    "Bumps [@bitbaum/chatkit](https://github.com/bitbaum/chatkit) from 0.3.1 to 0.3.2.",
    "- [Release notes](https://github.com/bitbaum/chatkit/releases)",
    "- [Commits](https://github.com/bitbaum/chatkit/compare/v0.3.1...v0.3.2)",
    "",
    "---",
    "updated-dependencies:",
    '- dependency-name: "@bitbaum/chatkit"',
    "  dependency-version: 0.3.2",
    "  dependency-type: direct:production",
    "  update-type: version-update:semver-patch",
    "...",
  ].join("\n"),
};

const GROUPED = {
  title: "chore(deps): bump the bitbaum group across 1 directory with 2 updates",
  body: [
    "Bumps the bitbaum group with 2 updates in the / directory: [@bitbaum/ai-kit](https://github.com/bitbaum/ai-kit) and [@bitbaum/chatkit](https://github.com/bitbaum/chatkit).",
    "",
    "Updates `@bitbaum/ai-kit` from 1.20.1 to 2.0.0",
    "- [Release notes](https://github.com/bitbaum/ai-kit/releases)",
    "- [Commits](https://github.com/bitbaum/ai-kit/compare/v1.20.1...v2.0.0)",
    "",
    "Updates `@bitbaum/chatkit` from 0.3.1 to 0.3.4",
    "- [Commits](https://github.com/bitbaum/chatkit/compare/v0.3.1...v0.3.4)",
    "",
    "---",
    "updated-dependencies:",
    '- dependency-name: "@bitbaum/ai-kit"',
    "  dependency-version: 2.0.0",
    "  update-type: version-update:semver-major",
    "  dependency-group: bitbaum",
  ].join("\n"),
};

/** Loki's own #1175, trimmed: a third-party group, no fleet package in it. */
const THIRD_PARTY_GROUP = {
  title: "chore(deps): bump the minor-and-patch group with 8 updates",
  body: [
    "Bumps the minor-and-patch group with 8 updates:",
    "",
    "| Package | From | To |",
    "| --- | --- | --- |",
    "| [drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | `0.45.3` | `0.45.4` |",
    "",
    "Updates `drizzle-orm` from 0.45.3 to 0.45.4",
    "Updates `next` from 16.3.8 to 16.4.0",
  ].join("\n"),
};

const ALIAS = {
  title: "chore(deps): bump @fleet/ai-forms from 0.1.2 to 0.1.3",
  body: "Bumps [@fleet/ai-forms](https://github.com/bitbaum/ai-forms) from 0.1.2 to 0.1.3.",
};

const GIT_TAG = {
  title: "chore(deps): bump whenkit from v0.2.1 to v0.2.2",
  body: [
    "Bumps [whenkit](https://github.com/bitbaum/whenkit) from v0.2.1 to v0.2.2.",
    "- [Commits](https://github.com/bitbaum/whenkit/compare/v0.2.1...v0.2.2)",
  ].join("\n"),
};

const GIT_SHA = {
  title: "chore(deps): bump @bitbaum/chatkit from `b8b6c1f` to `c3d4e5f`",
  body: "Bumps [@bitbaum/chatkit](https://github.com/bitbaum/chatkit) from `b8b6c1f` to `c3d4e5f`.\n- [Commits](https://github.com/bitbaum/chatkit/compare/b8b6c1f...c3d4e5f)",
};

const CATALOGUE = new Set([
  "@bitbaum/ai-kit",
  "@bitbaum/chatkit",
  "@bitbaum/whenkit",
  "ai-forms",
  "listkit",
]);
/** package.json keys that are not the catalogue name (from project_packages.dep_name). */
const DEP_NAMES = new Map([
  ["@fleet/ai-forms", "ai-forms"],
  ["whenkit", "@bitbaum/whenkit"],
]);

const bumpsOf = (pr: { title: string; body: string | null }) =>
  matchBumps(parseDependabotBumps(pr.title, pr.body), CATALOGUE, DEP_NAMES);

// ── fake GitHub + store ─────────────────────────────────────────────────────

type Call = { op: string; number: number; arg?: string };

function fakeGithub(opts: {
  pulls?: GithubPull[];
  checks?: (string | null)[] | null;
  canWrite?: boolean;
  fail?: Partial<Record<"addLabel" | "removeLabel" | "comment" | "merge", WriteResult>>;
}): UpdateGithub & { calls: Call[] } {
  const calls: Call[] = [];
  const pulls = opts.pulls ?? [];
  const ok: WriteResult = { ok: true };
  return {
    calls,
    canWrite: opts.canWrite ?? true,
    async listOpenPulls() {
      calls.push({ op: "list", number: 0 });
      return pulls.filter((p) => p.state === "open");
    },
    async getPull(_ref, number) {
      calls.push({ op: "get", number });
      return pulls.find((p) => p.number === number) ?? null;
    },
    async checkConclusions() {
      calls.push({ op: "checks", number: 0 });
      return opts.checks === undefined ? ["success"] : opts.checks;
    },
    async addLabel(_r, number, label) {
      calls.push({ op: "addLabel", number, arg: label });
      return opts.fail?.addLabel ?? ok;
    },
    async removeLabel(_r, number, label) {
      calls.push({ op: "removeLabel", number, arg: label });
      return opts.fail?.removeLabel ?? ok;
    },
    async comment(_r, number, body) {
      calls.push({ op: "comment", number, arg: body });
      return opts.fail?.comment ?? ok;
    },
    async merge(_r, number) {
      calls.push({ op: "merge", number });
      return opts.fail?.merge ?? ok;
    },
  };
}

function memoryStore(
  rows: PackageUpdateRequestRow[] = [],
  keys: Array<{ packageName: string; depName: string | null }> = [
    { packageName: "@bitbaum/chatkit", depName: "@bitbaum/chatkit" },
  ],
): UpdateStore & { rows: PackageUpdateRequestRow[] } {
  return {
    rows,
    async listForProject() {
      return rows;
    },
    async listPackageKeys() {
      return keys;
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

function pull(over: Partial<GithubPull> & { title: string; body: string | null }): GithubPull {
  return {
    number: 12,
    url: "https://github.com/bitbaum/site/pull/12",
    headSha: "a".repeat(40),
    authorLogin: "dependabot[bot]",
    authorType: "Bot",
    labels: [],
    createdAt: "2026-10-12T05:00:00Z",
    state: "open",
    merged: false,
    ...over,
  };
}

const NOW = new Date("2026-10-14T09:00:00Z");

function ctx(setting: PackageUpdateSetting, gh: UpdateGithub, store: UpdateStore): UpdateContext {
  return {
    userId: "u1",
    project: { id: "p1", packageUpdates: setting },
    ref: { owner: "bitbaum", repo: "site", slug: "bitbaum/site" } as UpdateContext["ref"],
    catalogueNames: CATALOGUE,
    gh,
    store,
    now: NOW,
  };
}

function row(over: Partial<PackageUpdateRequestRow>): PackageUpdateRequestRow {
  return {
    id: "row-12",
    userId: "u1",
    projectId: "p1",
    prNumber: 12,
    prUrl: "https://github.com/bitbaum/site/pull/12",
    title: SINGLE.title,
    headSha: "a".repeat(40),
    packages: bumpsOf(SINGLE),
    ciState: "green",
    state: "held",
    heldByLoki: true,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    detail: null,
    openedAt: NOW,
    observedAt: NOW,
    ...over,
  };
}

async function main() {
  console.log("package updates — reading Dependabot:");

  await check("a single bump: name, from, to, from the body", () => {
    const [b] = bumpsOf(SINGLE);
    assert.deepEqual(b, {
      name: "@bitbaum/chatkit",
      dependency: "@bitbaum/chatkit",
      from: "0.3.1",
      to: "0.3.2",
      breaking: false,
      fleet: true,
    });
  });

  await check("a grouped bump: every member from the body, the title names none", () => {
    assert.ok(isGroupedTitle(GROUPED.title));
    const bumps = bumpsOf(GROUPED);
    assert.deepEqual(
      bumps.map((b) => [b.name, b.from, b.to, b.breaking]),
      [
        ["@bitbaum/ai-kit", "1.20.1", "2.0.0", true],
        ["@bitbaum/chatkit", "0.3.1", "0.3.4", false],
      ],
    );
    assert.equal(anyBreaking(bumps), true, "one breaking member makes the PR breaking");
    assert.deepEqual(
      parseDependabotBumps(GROUPED.title, ""),
      [],
      "a group title alone is not a bump",
    );
  });

  await check("a third-party group is read but matches no fleet package", () => {
    const bumps = bumpsOf(THIRD_PARTY_GROUP);
    assert.equal(bumps.length, 2);
    assert.ok(bumps.every((b) => !b.fleet));
  });

  await check("an npm alias is matched through the key package.json lists it under", () => {
    const [b] = bumpsOf(ALIAS);
    assert.equal(b.name, "ai-forms");
    assert.equal(b.dependency, "@fleet/ai-forms", "commands to Dependabot keep its own name");
    assert.equal(b.fleet, true);
  });

  await check("a git tag bump: `v` versions, matched by key, judged as semver", () => {
    const [b] = bumpsOf(GIT_TAG);
    assert.deepEqual(
      [b.name, b.from, b.to, b.breaking],
      ["@bitbaum/whenkit", "v0.2.1", "v0.2.2", false],
    );
    assert.equal(versionLabel(b.to), "v0.2.2");
    assert.equal(versionLabel("0.2.2"), "v0.2.2");
  });

  await check("a git sha bump cannot be judged, so it counts as breaking", () => {
    const [b] = bumpsOf(GIT_SHA);
    assert.deepEqual([b.from, b.to, b.breaking], ["b8b6c1f", "c3d4e5f", true]);
    assert.equal(versionLabel(b.to), "c3d4e5f", "a sha is shown as it is, not as v-something");
  });

  await check("the title is the fallback: `in /dir` suffixes, other prefixes", () => {
    assert.deepEqual(parseDependabotBumps("Bump listkit from 0.1.0 to 0.1.1 in /desktop", null), [
      { dependency: "listkit", from: "0.1.0", to: "0.1.1" },
    ]);
    assert.deepEqual(
      parseDependabotBumps("build(deps-dev): bump @bitbaum/ai-kit from 1.2.0 to 1.3.0", ""),
      [{ dependency: "@bitbaum/ai-kit", from: "1.2.0", to: "1.3.0" }],
    );
    assert.deepEqual(parseDependabotBumps("Add a page", "Some prose with no bump line."), []);
  });

  await check("breaking: a major, or a minor under 1.0 — the sweep's rule", () => {
    assert.equal(isBreakingBump("1.20.1", "2.0.0"), true);
    assert.equal(isBreakingBump("1.20.1", "1.21.0"), false);
    assert.equal(isBreakingBump("1.20.1", "1.20.2"), false);
    assert.equal(isBreakingBump("0.3.1", "0.4.0"), true, "under 1.0 a minor breaks");
    assert.equal(isBreakingBump("0.3.1", "0.3.9"), false);
    assert.equal(isBreakingBump("v0.2.1", "v0.2.2"), false);
    assert.equal(isBreakingBump("0.9.0", "1.0.0"), true);
    assert.equal(isBreakingBump("abc", "def"), true, "unknown is never permission");
  });

  await check(
    "ignore commands: this <part> version, per dependency in a group, close for a sha",
    () => {
      assert.deepEqual(ignoreCommands(bumpsOf(SINGLE), false), [
        "@dependabot ignore this patch version",
      ]);
      assert.deepEqual(
        ignoreCommands([{ dependency: "x", from: "1.0.0", to: "2.0.0", fleet: true }], false),
        ["@dependabot ignore this major version"],
      );
      assert.deepEqual(
        ignoreCommands([{ dependency: "x", from: "0.3.0", to: "0.4.0", fleet: true }], false),
        ["@dependabot ignore this minor version"],
      );
      assert.deepEqual(ignoreCommands(bumpsOf(GROUPED), true), [
        "@dependabot ignore @bitbaum/ai-kit major version",
        "@dependabot ignore @bitbaum/chatkit patch version",
      ]);
      assert.deepEqual(ignoreCommands(bumpsOf(GIT_SHA), false), ["@dependabot close"]);
    },
  );

  await check("GitHub's pull JSON is read defensively", () => {
    const p = readPull({
      number: 7,
      html_url: "https://github.com/o/r/pull/7",
      title: "t",
      body: null,
      head: { sha: "b".repeat(40) },
      user: { login: "dependabot[bot]", type: "Bot" },
      labels: [{ name: "dependencies" }, { name: "hold" }, {}],
      created_at: "2026-10-12T05:00:00Z",
      state: "closed",
      merged_at: "2026-10-12T06:00:00Z",
    });
    assert.deepEqual(p?.labels, ["dependencies", "hold"]);
    assert.equal(p?.merged, true);
    assert.equal(readPull({ title: "no number" }), null);
  });

  console.log("package updates — the decision table:");

  await check("checks: none is unknown, any failure is red, any running is pending", () => {
    assert.equal(ciStateFrom(null), "unknown");
    assert.equal(ciStateFrom([]), "unknown");
    assert.equal(ciStateFrom(["success", "skipped", "neutral"]), "green");
    assert.equal(ciStateFrom(["success", null]), "pending");
    assert.equal(ciStateFrom(["success", null, "failure"]), "red");
    assert.equal(ciStateFrom(["cancelled"]), "red");
  });

  type Case = [
    PackageUpdateSetting,
    boolean, // breaking
    string[], // labels
    boolean, // heldByLoki
    UpdateDecision | null,
    CiState,
    // expected
    {
      label: "add" | "remove" | "none";
      heldByLoki: boolean;
      state: string;
      merge?: boolean;
      decision?: UpdateDecision | null;
    },
  ];
  const TABLE: Case[] = [
    // auto: non-breaking merges itself; Loki holds nothing, and lifts only its own hold
    ["auto", false, [], false, null, "green", { label: "none", heldByLoki: false, state: "open" }],
    [
      "auto",
      false,
      ["hold"],
      true,
      null,
      "green",
      { label: "remove", heldByLoki: false, state: "open" },
    ],
    [
      "auto",
      false,
      ["hold"],
      false,
      null,
      "green",
      { label: "none", heldByLoki: false, state: "held" },
    ],
    [
      "auto",
      false,
      ["wip"],
      false,
      null,
      "green",
      { label: "none", heldByLoki: false, state: "held" },
    ],
    // auto + breaking: always asks
    ["auto", true, [], false, null, "green", { label: "add", heldByLoki: true, state: "held" }],
    [
      "auto",
      true,
      ["hold"],
      true,
      null,
      "green",
      { label: "none", heldByLoki: true, state: "held" },
    ],
    [
      "auto",
      true,
      ["hold"],
      false,
      null,
      "green",
      { label: "none", heldByLoki: false, state: "held" },
    ],
    // ask: every update waits
    ["ask", false, [], false, null, "green", { label: "add", heldByLoki: true, state: "held" }],
    [
      "ask",
      false,
      ["hold"],
      true,
      null,
      "green",
      { label: "none", heldByLoki: true, state: "held" },
    ],
    [
      "ask",
      false,
      ["hold"],
      false,
      null,
      "green",
      { label: "none", heldByLoki: false, state: "held" },
    ],
    ["ask", true, [], false, null, "green", { label: "add", heldByLoki: true, state: "held" }],
    // ask beside a person's `wip`: Loki adds its own, theirs may come off for their reasons
    [
      "ask",
      false,
      ["wip"],
      false,
      null,
      "green",
      { label: "add", heldByLoki: true, state: "held" },
    ],
    // pinned: nothing moves
    ["pinned", false, [], false, null, "green", { label: "add", heldByLoki: true, state: "held" }],
    [
      "pinned",
      true,
      ["hold"],
      true,
      null,
      "green",
      { label: "none", heldByLoki: true, state: "held" },
    ],
    // a person took Loki's hold off on GitHub: Loki stands aside — no hold back, and no merge
    [
      "ask",
      false,
      [],
      true,
      null,
      "green",
      { label: "none", heldByLoki: false, state: "open", decision: "released" },
    ],
    [
      "pinned",
      true,
      [],
      true,
      null,
      "green",
      { label: "none", heldByLoki: false, state: "open", decision: "released", merge: false },
    ],
    [
      "ask",
      false,
      [],
      false,
      "released",
      "green",
      { label: "none", heldByLoki: false, state: "open", decision: "released" },
    ],
    // approved
    [
      "ask",
      false,
      ["hold"],
      true,
      "update",
      "green",
      { label: "remove", heldByLoki: false, state: "approved", merge: false },
    ],
    [
      "pinned",
      false,
      ["hold"],
      true,
      "update",
      "pending",
      { label: "remove", heldByLoki: false, state: "approved", merge: false },
    ],
    [
      "auto",
      true,
      ["hold"],
      true,
      "update",
      "green",
      { label: "remove", heldByLoki: false, state: "approved", merge: true },
    ],
    [
      "auto",
      true,
      ["hold"],
      true,
      "update",
      "pending",
      { label: "remove", heldByLoki: false, state: "approved", merge: false },
    ],
    [
      "auto",
      true,
      ["hold"],
      true,
      "update",
      "red",
      { label: "remove", heldByLoki: false, state: "approved", merge: false },
    ],
    // approved, but a person's hold is there: Loki neither removes it nor merges past it
    [
      "auto",
      true,
      ["hold"],
      false,
      "update",
      "green",
      { label: "none", heldByLoki: false, state: "approved", merge: false },
    ],
    [
      "auto",
      true,
      ["hold", "wip"],
      true,
      "update",
      "green",
      { label: "remove", heldByLoki: false, state: "approved", merge: false },
    ],
    // not now / stay keep it held whatever the setting
    ["auto", false, [], false, "later", "green", { label: "add", heldByLoki: true, state: "held" }],
    [
      "auto",
      false,
      ["hold"],
      true,
      "stay",
      "green",
      { label: "none", heldByLoki: true, state: "held" },
    ],
  ];

  await check(
    `enforcement: ${TABLE.length} cases (setting × breaking × whose hold × decision)`,
    () => {
      for (const [setting, breaking, labels, heldByLoki, decision, ciState, want] of TABLE) {
        const got = decideEnforcement({ setting, breaking, labels, heldByLoki, decision, ciState });
        const name = `${setting}/${breaking ? "breaking" : "minor"}/[${labels}]/${heldByLoki ? "loki" : "-"}/${decision}/${ciState}`;
        assert.equal(got.label, want.label, `${name}: label`);
        assert.equal(got.heldByLoki, want.heldByLoki, `${name}: heldByLoki`);
        assert.equal(got.state, want.state, `${name}: state`);
        assert.equal(got.merge, want.merge ?? false, `${name}: merge`);
        if ("decision" in want) assert.equal(got.decision, want.decision, `${name}: decision`);
      }
    },
  );

  await check("enforcement notes say what happens next", () => {
    const base = {
      setting: "auto" as const,
      labels: ["hold"],
      heldByLoki: true,
      decision: "update" as const,
    };
    assert.equal(
      decideEnforcement({ ...base, breaking: true, ciState: "pending" }).note,
      ENFORCEMENT_NOTES.waitingChecks,
    );
    assert.equal(
      decideEnforcement({ ...base, breaking: true, ciState: "red" }).note,
      ENFORCEMENT_NOTES.redChecks,
    );
    assert.equal(
      decideEnforcement({ ...base, breaking: true, ciState: "unknown" }).note,
      ENFORCEMENT_NOTES.noChecks,
    );
    assert.equal(
      decideEnforcement({ ...base, breaking: false, ciState: "pending" }).note,
      ENFORCEMENT_NOTES.sweepMerges,
    );
    assert.equal(
      decideEnforcement({ ...base, labels: ["hold", "wip"], breaking: true, ciState: "green" })
        .note,
      ENFORCEMENT_NOTES.humanHold,
    );
  });

  await check(
    "Approvals asks about held updates on ask, breaking ones on auto, nothing on pinned",
    () => {
      const now = NOW.getTime();
      const minor = [{ breaking: false }];
      const major = [{ breaking: true }];
      const held = { state: "held" as const, decision: null, snoozedUntil: null };
      assert.equal(needsDecision({ ...held, packages: minor }, "ask", now), true);
      assert.equal(
        needsDecision({ ...held, packages: minor }, "auto", now),
        false,
        "a person's own hold on auto is theirs",
      );
      assert.equal(needsDecision({ ...held, packages: major }, "auto", now), true);
      assert.equal(needsDecision({ ...held, packages: major }, "pinned", now), false);
      assert.equal(needsDecision({ ...held, state: "open", packages: major }, "ask", now), false);
      const snoozed = { ...held, decision: "later" as const, packages: minor };
      assert.equal(
        needsDecision({ ...snoozed, snoozedUntil: new Date(now + 1000) }, "ask", now),
        false,
      );
      assert.equal(
        needsDecision({ ...snoozed, snoozedUntil: new Date(now - 1000) }, "ask", now),
        true,
        "Not now runs out",
      );
      assert.equal(
        needsDecision({ ...held, decision: "stay", packages: minor }, "ask", now),
        false,
      );
    },
  );

  await check("status words: waiting on tests / held for you / ready", () => {
    assert.equal(
      updateStatus({ state: "open", decision: null, ciState: "pending" }, "auto").label,
      "waiting on tests",
    );
    assert.equal(
      updateStatus({ state: "open", decision: null, ciState: "green" }, "auto").label,
      "ready",
    );
    assert.equal(
      updateStatus({ state: "approved", decision: "update", ciState: "red" }, "ask").label,
      "tests failed",
    );
    assert.equal(
      updateStatus({ state: "held", decision: null, ciState: "green" }, "ask").label,
      "held for you",
    );
    assert.match(
      updateStatus({ state: "held", decision: null, ciState: "green" }, "pinned").label,
      /staying/,
    );
  });

  console.log("package updates — sync and decisions against a fake GitHub:");

  await check(
    "sync holds a fleet update on ask; ignores people's PRs and third-party bumps",
    async () => {
      const gh = fakeGithub({
        pulls: [
          pull({ ...SINGLE }),
          pull({
            number: 13,
            title: "Add pricing page",
            body: "",
            authorLogin: "cato",
            authorType: "User",
          }),
          pull({ number: 14, ...THIRD_PARTY_GROUP }),
          // A person with the bot's name is not the bot.
          pull({ number: 15, ...SINGLE, authorType: "User" }),
        ],
      });
      const store = memoryStore();
      const out = await syncProjectUpdates(ctx("ask", gh, store));
      assert.deepEqual(out, { open: 1, held: 1 });
      assert.equal(store.rows.length, 1);
      assert.deepEqual(
        gh.calls.filter((c) => c.op === "addLabel"),
        [{ op: "addLabel", number: 12, arg: "hold" }],
      );
      assert.equal(store.rows[0]!.heldByLoki, true);
      assert.equal(store.rows[0]!.state, "held");
      assert.equal(store.rows[0]!.ciState, "green");
    },
  );

  await check("sync on auto leaves a non-breaking update to the sweep, untouched", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE })] });
    const store = memoryStore();
    await syncProjectUpdates(ctx("auto", gh, store));
    assert.equal(
      gh.calls.some((c) => c.op === "addLabel" || c.op === "removeLabel"),
      false,
    );
    assert.equal(store.rows[0]!.state, "open");
  });

  await check("switching back to auto lifts Loki's own hold, never a person's", async () => {
    const mine = memoryStore([row({ heldByLoki: true })]);
    const gh1 = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })] });
    await syncProjectUpdates(ctx("auto", gh1, mine));
    assert.deepEqual(
      gh1.calls.filter((c) => c.op === "removeLabel").map((c) => c.arg),
      ["hold"],
    );
    assert.equal(mine.rows[0]!.heldByLoki, false);

    const theirs = memoryStore([row({ heldByLoki: false })]);
    const gh2 = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })] });
    await syncProjectUpdates(ctx("auto", gh2, theirs));
    assert.equal(
      gh2.calls.some((c) => c.op === "removeLabel"),
      false,
    );
    assert.equal(theirs.rows[0]!.state, "held");
  });

  await check("Loki's hold taken off on GitHub: not put back, never merged by Loki", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...GROUPED, labels: [] })], checks: ["success"] });
    const store = memoryStore([row({ title: GROUPED.title, packages: bumpsOf(GROUPED) })]);
    await syncProjectUpdates(ctx("ask", gh, store));
    assert.equal(
      gh.calls.some((c) => ["addLabel", "removeLabel", "merge"].includes(c.op)),
      false,
    );
    assert.equal(store.rows[0]!.decision, "released");
    assert.equal(store.rows[0]!.heldByLoki, false);
    // …and it stays that way on the next read.
    const again = fakeGithub({ pulls: [pull({ ...GROUPED, labels: [] })], checks: ["success"] });
    await syncProjectUpdates(ctx("ask", again, store));
    assert.equal(
      again.calls.some((c) => ["addLabel", "merge"].includes(c.op)),
      false,
    );
    assert.equal(
      needsDecision(store.rows[0]!, "ask", NOW.getTime()),
      false,
      "and it is not on Approvals",
    );
  });

  await check("a finished check verdict on the same commit is not asked again", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })] });
    await syncProjectUpdates(ctx("ask", gh, memoryStore([row({ ciState: "green" })])));
    assert.equal(
      gh.calls.some((c) => c.op === "checks"),
      false,
    );
    const gh2 = fakeGithub({
      pulls: [pull({ ...SINGLE, labels: ["hold"], headSha: "c".repeat(40) })],
    });
    await syncProjectUpdates(ctx("ask", gh2, memoryStore([row({ ciState: "green" })])));
    assert.equal(gh2.calls.filter((c) => c.op === "checks").length, 1, "a new head is asked");
  });

  await check("a project built from no fleet package costs no request", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE })] });
    await syncProjectUpdates(ctx("ask", gh, memoryStore([], [])));
    assert.deepEqual(gh.calls, []);
  });

  await check("a tracked update that closed is looked up once and recorded", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE, state: "closed", merged: true })] });
    const store = memoryStore([row({})]);
    await syncProjectUpdates(ctx("ask", gh, store));
    assert.equal(store.rows[0]!.state, "merged");
  });

  await check("a hold Loki could not add is not reported as held, and says why", async () => {
    const gh = fakeGithub({
      pulls: [pull({ ...SINGLE })],
      canWrite: false,
      fail: { addLabel: { ok: false, status: 0, message: "no GitHub token" } },
    });
    const store = memoryStore();
    await syncProjectUpdates(ctx("ask", gh, store));
    assert.equal(store.rows[0]!.state, "open");
    assert.equal(store.rows[0]!.heldByLoki, false);
    assert.equal(store.rows[0]!.detail, UPDATE_MESSAGES.cannotWrite);
  });

  const breakingPull = (over: Partial<GithubPull> = {}) =>
    pull({ ...GROUPED, labels: ["hold"], ...over });
  const breakingRow = (over: Partial<PackageUpdateRequestRow> = {}) =>
    row({ title: GROUPED.title, packages: bumpsOf(GROUPED), ...over });

  await check(
    "Update on a breaking update with green checks: lift the hold, then merge",
    async () => {
      const gh = fakeGithub({ pulls: [breakingPull()], checks: ["success"] });
      const store = memoryStore([breakingRow({ ciState: "pending" })]);
      const out = await applyUpdateDecision(ctx("auto", gh, store), store.rows[0]!, "update");
      assert.deepEqual(
        gh.calls.filter((c) => !["get", "checks"].includes(c.op)).map((c) => c.op),
        ["removeLabel", "merge"],
      );
      assert.deepEqual([out.ok, out.state, out.message], [true, "merged", UPDATE_MESSAGES.merged]);
      assert.equal(store.rows[0]!.decision, "update");
    },
  );

  await check("Update on a breaking update still running: lift the hold, merge later", async () => {
    const gh = fakeGithub({ pulls: [breakingPull()], checks: ["success", null] });
    const store = memoryStore([breakingRow({ ciState: "pending" })]);
    const out = await applyUpdateDecision(ctx("auto", gh, store), store.rows[0]!, "update");
    assert.equal(
      gh.calls.some((c) => c.op === "merge"),
      false,
    );
    assert.deepEqual(
      [out.ok, out.state, out.message],
      [true, "approved", ENFORCEMENT_NOTES.waitingChecks],
    );
    // …and the next sync, once green, merges it.
    const later = fakeGithub({ pulls: [breakingPull({ labels: [] })], checks: ["success"] });
    await syncProjectUpdates(ctx("auto", later, store));
    assert.ok(later.calls.some((c) => c.op === "merge"));
    assert.equal(store.rows[0]!.state, "merged");
  });

  await check("Update on a non-breaking update: lift the hold, the sweep merges it", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })] });
    const store = memoryStore([row({})]);
    const out = await applyUpdateDecision(ctx("ask", gh, store), store.rows[0]!, "update");
    assert.deepEqual(
      gh.calls.filter((c) => c.op === "removeLabel" || c.op === "merge").map((c) => c.op),
      ["removeLabel"],
    );
    assert.deepEqual([out.state, out.message], ["approved", ENFORCEMENT_NOTES.sweepMerges]);
  });

  await check("Not now: no GitHub call, hidden for seven days", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })] });
    const store = memoryStore([row({})]);
    const out = await applyUpdateDecision(ctx("ask", gh, store), store.rows[0]!, "later");
    assert.deepEqual(gh.calls, []);
    assert.equal(out.ok, true);
    assert.equal(store.rows[0]!.snoozedUntil?.toISOString(), "2026-10-21T09:00:00.000Z");
  });

  await check("Stay on this version: tell Dependabot, keep the hold", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })] });
    const store = memoryStore([row({})]);
    const out = await applyUpdateDecision(ctx("ask", gh, store), store.rows[0]!, "stay");
    assert.deepEqual(
      gh.calls.filter((c) => c.op === "comment").map((c) => c.arg),
      ["@dependabot ignore this patch version"],
    );
    assert.equal(
      gh.calls.some((c) => c.op === "removeLabel" || c.op === "merge"),
      false,
    );
    assert.deepEqual([out.ok, out.state, out.message], [true, "held", UPDATE_MESSAGES.stay]);
    assert.equal(store.rows[0]!.decision, "stay");

    const grouped = fakeGithub({ pulls: [breakingPull()] });
    const gStore = memoryStore([breakingRow()]);
    await applyUpdateDecision(ctx("auto", grouped, gStore), gStore.rows[0]!, "stay");
    assert.deepEqual(
      grouped.calls.filter((c) => c.op === "comment").map((c) => c.arg),
      [
        "@dependabot ignore @bitbaum/ai-kit major version",
        "@dependabot ignore @bitbaum/chatkit patch version",
      ],
    );
  });

  await check(
    "no write access: the decision is refused with the way forward, nothing is called",
    async () => {
      const gh = fakeGithub({ pulls: [pull({ ...SINGLE, labels: ["hold"] })], canWrite: false });
      const store = memoryStore([row({})]);
      const out = await applyUpdateDecision(ctx("ask", gh, store), store.rows[0]!, "update");
      assert.deepEqual([out.ok, out.message], [false, UPDATE_MESSAGES.cannotWrite]);
      assert.deepEqual(gh.calls, []);
    },
  );

  await check("a merge GitHub refuses comes back as a failure, not a success", async () => {
    const gh = fakeGithub({
      pulls: [breakingPull()],
      fail: { merge: { ok: false, status: 405, message: "Pull Request is not mergeable" } },
    });
    const store = memoryStore([breakingRow()]);
    const out = await applyUpdateDecision(ctx("auto", gh, store), store.rows[0]!, "update");
    assert.equal(out.ok, false);
    assert.match(out.message, /not mergeable/);
    assert.equal(store.rows[0]!.state, "approved");
  });

  await check("a pull request already merged on GitHub is recorded, not acted on", async () => {
    const gh = fakeGithub({ pulls: [pull({ ...SINGLE, state: "closed", merged: true })] });
    const store = memoryStore([row({})]);
    const out = await applyUpdateDecision(ctx("ask", gh, store), store.rows[0]!, "update");
    assert.deepEqual(
      [out.ok, out.state, out.message],
      [true, "merged", UPDATE_MESSAGES.mergedAlready],
    );
    assert.equal(
      gh.calls.some((c) => c.op !== "get"),
      false,
    );
  });

  console.log("package updates — surfaces and routes:");

  await check("cards: held updates only, breaking first, versions labelled", () => {
    const base = {
      ...row({}),
      projectName: "Site",
      entityProjectId: "e1",
      packageUpdates: "ask",
    };
    const cards = buildUpdateCards(
      [
        base,
        {
          ...base,
          id: "r2",
          prNumber: 20,
          title: GROUPED.title,
          packages: bumpsOf(GROUPED),
          projectName: "Atelier",
          packageUpdates: "auto",
        },
        { ...base, id: "r3", prNumber: 21, state: "open" },
        { ...base, id: "r4", prNumber: 22, packageUpdates: "pinned" },
      ],
      NOW.getTime(),
    );
    assert.deepEqual(
      cards.map((c) => c.id),
      ["r2", "row-12"],
    );
    assert.deepEqual(cards[0]!.bumps[0], {
      name: "@bitbaum/ai-kit",
      from: "v1.20.1",
      to: "v2.0.0",
      breaking: true,
    });
    assert.equal(cards[1]!.projectHref, "/projects/e1");
    assert.equal(cards[1]!.checks.label, "Checks passed");
  });

  await check("the open update shows under its package, with its PR and state", () => {
    const open = indexOpenUpdates([{ ...row({ state: "held" }), packageUpdates: "ask" }]);
    const update = open.get("p1|@bitbaum/chatkit");
    assert.ok(update);
    const html = renderToStaticMarkup(createElement(OpenUpdateLine, { update }));
    assert.match(html, /Update open → <span[^>]*>v0\.3\.2/);
    assert.match(html, /held for you/);
    assert.match(html, /href="https:\/\/github\.com\/bitbaum\/site\/pull\/12"/);
    assert.equal(
      indexOpenUpdates([{ ...row({ state: "merged" }), packageUpdates: "ask" }]).size,
      0,
    );
  });

  await check("the setting: three choices, each with its consequence; unknown reads as ask", () => {
    assert.deepEqual(
      PACKAGE_UPDATE_SETTINGS.map((s) => s.id),
      ["auto", "ask", "pinned"],
    );
    assert.ok(PACKAGE_UPDATE_SETTINGS.every((s) => s.consequence.length > 10));
    assert.equal(PackageUpdateSettingBody.safeParse({ setting: "ask" }).success, true);
    assert.equal(PackageUpdateSettingBody.safeParse({ setting: "sometimes" }).success, false);
    assert.equal(PackageUpdateSettingBody.safeParse({}).success, false);
    assert.equal(UpdateDecisionBody.safeParse({ decision: "stay" }).success, true);
    assert.equal(UpdateDecisionBody.safeParse({ decision: "merge-everything" }).success, false);
    assert.equal(readPackageUpdateSetting("pinned"), "pinned");
    assert.equal(readPackageUpdateSetting("weekly"), "ask", "an unknown value is never permission");
    assert.equal(readPackageUpdateSetting(null), "ask");
  });

  await check("the setting route answers only the owner, validated against the config", () => {
    const route = src("src/app/api/projects/[id]/package-updates/route.ts");
    assert.match(route, /getApiUserId\(\)/);
    assert.match(route, /jsonError\("Unauthorized", 401\)/);
    assert.match(route, /readJsonBody\(req, PackageUpdateSettingBody\)/);
    assert.match(route, /setProjectPackageUpdates\(userId, /);
    assert.match(route, /jsonOk\(/);
    const query = src("src/db/queries/package-updates.ts");
    const fn = query.slice(query.indexOf("export async function setProjectPackageUpdates"));
    assert.match(fn.slice(0, 800), /eq\(userProjects\.userId, userId\)/, "owner only");
  });

  await check("the decision route answers only the update's owner", () => {
    const route = src("src/app/api/packages/updates/[id]/route.ts");
    assert.match(route, /getApiUserId\(\)/);
    assert.match(route, /readJsonBody\(req, UpdateDecisionBody\)/);
    assert.match(route, /getUpdateRequestForUser\(userId, /);
    const query = src("src/db/queries/package-updates.ts");
    const fn = query.slice(query.indexOf("export async function getUpdateRequestForUser"));
    assert.match(fn.slice(0, 700), /eq\(packageUpdateRequests\.userId, userId\)/);
  });

  await check(
    "the box applies settings every 15 minutes, on the schedule the copy promises",
    () => {
      const installer = src("scripts/install-hetzner-crons.sh");
      assert.ok(installer.includes(`[sync-package-updates]="${UPDATE_SYNC_SCHEDULE}"`));
      const cron = src("src/app/api/crons/sync-package-updates/route.ts");
      assert.match(cron, /requireCronAuth/);
      assert.match(cron, /updatesOnly: true/);
    },
  );

  await check("Approvals and the project page carry the new surfaces", () => {
    assert.match(
      src("src/app/(app)/approvals/page.tsx"),
      /<PackageUpdateQueue updates=\{updates\} recent=\{recentUpdates\} \/>/,
    );
    assert.match(
      src("src/components/packages/ProjectBuiltFrom.tsx"),
      /PackageUpdateSettingControl/,
    );
  });

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ package updates");
}

void main();
