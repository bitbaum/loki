import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "../../src/lib/utils";
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
  const project = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const run = "11111111-2222-4333-8444-555555555555";
  let pinned: unknown = null;
  let latestReads = 0;
  const bindings = {
    NextResponse,
    isValidUuid,
    getSessionUserId: async () => "viewer",
    getProjectAccess: async () => null,
    readIdParam: async () => project,
    getProjectCore: async () => ({ name: "loki" }),
    getServerKickoff: () => null,
    getOrchestrationRunById: async () => pinned,
    getProjectOrchestrationRuns: async () => {
      latestReads++;
      return [];
    },
    getLatestRunForProjectKey: async () => null,
  };
  const get = new Function(...Object.keys(bindings), js + ";return GET;")(
    ...Object.values(bindings),
  );
  const call = (query: string) =>
    get(new NextRequest(`https://loki.example/api/projects/${project}/watch${query}`), {
      params: Promise.resolve({ id: project }),
    });
  assert.equal((await call("?run=invalid")).status, 400);
  assert.equal((await call(`?run=${run}`)).status, 404);
  pinned = { id: run, projectId: "another-project" };
  assert.equal((await call(`?run=${run}`)).status, 404);
  assert.equal(
    latestReads,
    0,
    "a missing or wrong-project pinned run cannot silently show some other run",
  );
  assert.equal((await call("")).status, 200);
  assert.equal(latestReads, 1);
  console.log("✓ pinned Watch links fail clearly instead of substituting another run");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
