import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { coldStartWorkspaceDir } from "@/lib/execution-access";
import { normalizeKickScope, sortProjectsForKick } from "@/lib/fleet-kick-format";
import { normalizeAutoInjectMode } from "@/config/beacon";
import { MAX_CONCURRENT_BUILDING } from "@/lib/constants/control";

async function main() {
  const source = fs.readFileSync("src/lib/fleet-kick.ts", "utf8");
  const parsed = ts.createSourceFile("fleet-kick.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name?.text === "kickFleet",
  )!;
  const js = ts.transpileModule(declaration.getText(parsed).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let active = 0;
  const calls: string[] = [];
  const overrides = new Map<string, string>();
  const projects = [
    { name: "repo-only", dirPath: null, gitUrl: "https://github.com/bitbaum/loki.git" },
    { name: "unconnected", dirPath: null, gitUrl: null },
    { name: "invalid", dirPath: null, gitUrl: "file:///etc" },
    { name: "local-folder", dirPath: "/private/project", gitUrl: null },
  ];
  const bindings = {
    getBeaconSettings: async () => ({ auto_inject_mode: "on" }),
    getRunnerConnected: async () => true,
    getUserProjects: async () => projects,
    loadProjectOverrides: async () => overrides,
    getProjectStatesByUserId: async () => [],
    countActiveRuns: async () => active,
    isProjectBusy: async () => false,
    hasOpenPendingForProject: async () => false,
    injectPrompt: async (params: { tab: string }, userId: string) => {
      assert.equal(userId, "owner");
      calls.push(params.tab);
      return { status: 200, body: { ok: true } };
    },
    normalizeAutoInjectMode,
    normalizeKickScope,
    sortProjectsForKick,
    coldStartWorkspaceDir,
    DEFAULT_AUTO_INJECT_MODE: "on",
    MAX_CONCURRENT_BUILDING,
    SESSION_STATUS: { READY: "ready" },
    formatFleetKickMessage: () => "Recorded outcome",
  };
  const kick = new Function(...Object.keys(bindings), js + ";return kickFleet;")(
    ...Object.values(bindings),
  );
  const options = { source: "start_my_day", requireFleetOn: false };
  const result = await kick("owner", options);
  assert.equal(result.kicked, 2);
  assert.deepEqual(calls.sort(), ["local-folder", "repo-only"]);
  assert(
    result.details.some(
      (d: { projectKey: string; reason: string }) =>
        d.projectKey === "invalid" && d.reason === "no_path",
    ),
  );
  calls.length = 0;
  overrides.set("repo-only", "off");
  await kick("owner", { ...options, projectKeys: ["repo-only"] });
  assert.equal(calls.length, 0, "a cloneable repo cannot bypass a pause");
  overrides.clear();
  active = MAX_CONCURRENT_BUILDING;
  await kick("owner", { ...options, projectKeys: ["repo-only"] });
  assert.equal(calls.length, 0, "a cloneable repo cannot bypass the work limit");
  console.log(
    "✓ repository-only starts reuse clone materialization and preserve pauses and capacity",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
