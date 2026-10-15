import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "../../src/lib/utils";
import { dispatchMessageDisplay } from "../../src/lib/terminal-conversation";
import { buildWatchTimeline } from "../../src/lib/project-watch";
import { fleetSurfaceHref } from "../../src/lib/fleet-context";
async function main() {
  const file = "src/app/api/projects/[id]/watch/route.ts";
  const parsed = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const fn = parsed.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "GET")!;
  const js = ts.transpileModule(fn.getText(parsed).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const project = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    runId = "11111111-2222-4333-8444-555555555555";
  let actor = "owner";
  let memberRole: "viewer" | "editor" | null = null;
  const readers: string[] = [];
  const run = {
    id: runId,
    projectId: project,
    projectKey: "loki",
    payload: {},
    adapter: "claude",
    startedAt: new Date(),
    finishedAt: new Date(),
    outcome: "failed",
    summary: null,
  };
  const packet =
    "# Loki operator dispatch\nInternal framing.\n\n## The operator's goals & deadlines\nPrivate life goal.\n\n## Your task (direct operator instruction)\nFix the project menu.\n\n## Exit contract\nInternal handoff.";
  const query = {
    from: () => query,
    where: (condition: unknown) => {
      assert(JSON.stringify(condition).includes('"owner"'));
      return query;
    },
    orderBy: () => query,
    limit: async () => [{ customPrompt: packet, resolvedPrompt: packet, dispatchedAt: new Date() }],
  };
  const ownerOnly = async (owner: string) => {
    readers.push(owner);
    assert.equal(owner, "owner");
  };
  const bindings = {
    NextResponse,
    isValidUuid,
    dispatchMessageDisplay,
    buildWatchTimeline,
    fleetSurfaceHref,
    FEEDBACK_STATUS: { DISPATCHED: "dispatched" },
    getSessionUserId: async () => actor,
    readIdParam: async () => project,
    getProjectAccess: async () =>
      actor === "owner"
        ? { ownerUserId: "owner", role: "owner", canEdit: true }
        : memberRole
          ? { ownerUserId: "owner", role: memberRole, canEdit: memberRole === "editor" }
          : null,
    getProjectCore: async (owner: string) =>
      owner === "owner" ? { id: project, name: "loki" } : null,
    getServerKickoff: () => null,
    getOrchestrationRunById: async (owner: string) => {
      await ownerOnly(owner);
      return run;
    },
    listRunEventsForRun: async (_id: string, owner: string) => {
      await ownerOnly(owner);
      return [];
    },
    db: { select: () => query },
    promptHistory: { userId: "userId", runId: "runId", dispatchedAt: "at" },
    eq: (...args: unknown[]) => args,
    and: (...args: unknown[]) => args,
    desc: (v: unknown) => v,
    hydrateFeedbackSnapshot: async (owner: string) => {
      await ownerOnly(owner);
      return null;
    },
    deriveFeedbackWork: () => ({}),
    buildTerminalRunView: () => ({
      phase: "failed",
      terminalReady: true,
      label: "Failed",
      stalled: false,
    }),
    getUserProjectByEntityId: async (owner: string) => {
      await ownerOnly(owner);
      return { id: "registered" };
    },
    getProjectAutopilotOverride: async (owner: string) => {
      await ownerOnly(owner);
      return null;
    },
    getBeaconSettings: async (owner: string) => {
      await ownerOnly(owner);
      return { auto_inject_mode: "on" };
    },
    providerLabel: () => "Claude",
  };
  const get = new Function(...Object.keys(bindings), js + ";return GET;")(
    ...Object.values(bindings),
  );
  const call = () =>
    get(new NextRequest(`https://loki.example/api/projects/${project}/watch?run=${runId}`), {
      params: Promise.resolve({ id: project }),
    });
  const owned = await (await call()).json();
  assert(
    owned.items.find((i: { type: string }) => i.type === "you").text.includes("Private life goal"),
  );
  assert(owned.canRetry);
  assert(owned.terminalHref);
  assert(owned.autopilot);
  actor = "member";
  for (const role of ["viewer", "editor"] as const) {
    memberRole = role;
    const response = await call();
    assert.equal(response.status, 200);
    const shared = await response.json();
    assert.equal(
      shared.items.find((i: { type: string }) => i.type === "you").text,
      "Fix the project menu.",
    );
    assert(!JSON.stringify(shared).includes("Private life goal"));
    assert.equal(shared.canRetry, false);
    assert.equal(shared.status.terminalReady, false);
    assert.equal(shared.terminalHref, undefined);
    assert.equal(shared.autopilot, undefined);
    assert.equal(shared.tab, undefined);
  }
  memberRole = null;
  const before = readers.length;
  assert.equal((await call()).status, 404);
  assert.equal(readers.length, before);
  console.log(
    "✓ invited members read project-scoped owner-tenant progress without personal dispatch context or owner-only terminal/actions; strangers cannot read it",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
