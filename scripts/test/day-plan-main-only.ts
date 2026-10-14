import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { rankDayProjects } from "@/lib/start-my-day/rank";
import { coldStartWorkspaceDir } from "@/lib/execution-access";

async function main() {
  const source = fs.readFileSync("src/lib/start-my-day/load.ts", "utf8");
  const parsed = ts.createSourceFile("load.ts", source, ts.ScriptTarget.Latest, true);
  const fn = parsed.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name?.text === "loadDayPlan",
  )!;
  const js = ts.transpileModule(fn.getText(parsed).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let mainProjectIds: string[] = [];
  const calls: string[] = [];
  const projects = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    name: `repo-${i}`,
    displayName: `Project ${i}`,
    userId: "owner",
    entityProjectId: `entity-${i}`,
    gitUrl: "https://github.com/bitbaum/loki.git",
    devLog: [],
    dirPath: null,
    canStart: true,
  }));
  const query = {
    from: () => query,
    where: () => query,
    groupBy: async () => [],
  };
  const bindings = {
    getDayCatalog: async () => projects,
    getDayPreferences: async () => ({ mainProjectIds, labels: { p1: "My main" } }),
    getProjectStatesByUserId: async () => [],
    loadProjectOverrides: async () => new Map(),
    db: { select: () => query },
    orchestrationRuns: { projectKey: "key", payload: "payload", userId: "user" },
    sql: () => "query",
    and: () => true,
    eq: () => true,
    getGithubToken: async () => {
      calls.push("token");
      return "fixture";
    },
    fetchRecentGithubCommits: async () => {
      calls.push("commit");
      return [{ atMs: Date.now() }];
    },
    isProjectBusy: async (_user: string, key: string) => {
      calls.push(key);
      return false;
    },
    hasOpenPendingForProject: async () => false,
    rankDayProjects,
    coldStartWorkspaceDir,
    NAV: { projects: { href: "/projects" }, control: { href: "/control" } },
  };
  const load = new Function(...Object.keys(bindings), js + ";return loadDayPlan;")(
    ...Object.values(bindings),
  );
  let plan = await load("operator");
  assert.equal(plan.catalog.length, 30, "all accessible projects remain available to choose");
  assert.equal(plan.projects.length, 0);
  assert.deepEqual(calls, [], "an empty main selection must not fan out across 30 repositories");
  mainProjectIds = ["p1"];
  plan = await load("operator");
  assert.equal(plan.catalog.length, 30);
  assert.deepEqual(plan.selectedIds, ["p1"]);
  assert.equal(plan.projects[0].name, "My main");
  assert.equal(plan.projects[0].unavailable, null, "a connected repo needs no computer folder");
  assert.equal(calls.filter((c) => c === "commit").length, 1);
  assert.deepEqual(
    calls.filter((c) => c.startsWith("repo-")),
    ["repo-1"],
  );
  console.log(
    "✓ main-project activity checks are bounded while the full accessible chooser stays available",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
