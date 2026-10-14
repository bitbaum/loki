import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { resolveDaySelection } from "@/lib/start-my-day/rank";
import { readDayPreferences } from "@/lib/start-my-day/preferences";

async function main() {
  const source = fs.readFileSync("src/app/api/control/start-my-day/route.ts", "utf8");
  const parsed = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const fn = parsed.statements
    .filter((s) => ts.isFunctionDeclaration(s) && ["POST", "PATCH"].includes(s.name?.text ?? ""))
    .map((s) => s.getText(parsed).replace(/^export /, ""));
  const js = ts.transpileModule(fn.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const catalog = [
    { id: "own", userId: "operator", name: "repo-key", canStart: true },
    { id: "shared", userId: "other-owner", name: "shared-key", canStart: true },
    { id: "viewer", userId: "other-owner", name: "view-key", canStart: false },
  ];
  const calls: string[] = [];
  let activeOwner: string | null = null;
  let body: Record<string, unknown> = {};
  let saved: unknown;
  class ApiResponse {
    constructor(
      public value: unknown,
      public status = 200,
    ) {}
  }
  const bindings = {
    getApiUserId: async () => "operator",
    NextResponse: ApiResponse,
    Body: {},
    PreferencesBody: {},
    readJsonBody: async () => body,
    getDayCatalog: async () => catalog,
    resolveDaySelection,
    jsonError: (error: string, status: number) => new ApiResponse({ error }, status),
    jsonOk: (value: unknown) => new ApiResponse(value),
    withDayStartLock: async (owner: string, run: () => Promise<unknown>) => {
      assert.equal(activeOwner, null, "locks must not nest in the one-connection lock pool");
      activeOwner = owner;
      try {
        return await run();
      } finally {
        activeOwner = null;
      }
    },
    kickFleet: async (owner: string, opts: { projectKeys: string[] }) => {
      assert.equal(activeOwner, owner, "use the execution owner's lock");
      calls.push(owner);
      return {
        ok: true,
        kicked: opts.projectKeys.length,
        details: opts.projectKeys.map((projectKey) => ({ projectKey, outcome: "kicked" })),
      };
    },
    saveDayPreferences: async (user: string, prefs: unknown) => {
      assert.equal(user, "operator");
      saved = prefs;
    },
  };
  const routes = new Function(...Object.keys(bindings), js + ";return {POST,PATCH};")(
    ...Object.values(bindings),
  );
  body = { projectIds: ["own", "shared"] };
  const response = await routes.POST({});
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["operator", "other-owner"]);
  assert.deepEqual(response.value.startedIds, ["own", "shared"]);
  calls.length = 0;
  body = { projectIds: ["viewer"] };
  assert.equal((await routes.POST({})).status, 403);
  body = { projectIds: ["forged"] };
  assert.equal((await routes.POST({})).status, 400);
  assert.equal(calls.length, 0, "no side effect on denied selection");
  body = { mainProjectIds: ["viewer", "shared"], labels: { shared: "Orange Cat" } };
  assert.equal((await routes.PATCH({})).status, 200, "viewers may choose personal priorities");
  assert.deepEqual(saved, body);
  body = { mainProjectIds: ["forged"], labels: {} };
  assert.equal((await routes.PATCH({})).status, 403);
  assert.deepEqual(
    readDayPreferences({ mainProjectIds: ["a", "a", 3], labels: { a: "  Human name  ", b: 12 } }),
    { mainProjectIds: ["a"], labels: { a: "Human name" } },
  );
  console.log(
    "✓ main-project dispatch respects shared roles, owner locks, stable keys and personal preferences",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
