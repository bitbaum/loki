import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";

// Exercise the real route and Zod boundary without an account, DB or builder.
// The side-effect seams record whether rejected requests reach dispatch.
const state = {
  userId: "owner" as string | null,
  locked: false,
  projects: [{ id: "00000000-0000-4000-8000-000000000001", name: "Loki" }],
  calls: [] as { userId: string; options: { projectKeys: string[]; requireFleetOn: boolean } }[],
};
const mocks: Record<string, string> = {
  "@/lib/session": "export async function getApiUserId() { return state.userId; }",
  "@/db/queries/user-projects":
    "export async function getUserProjects() { return state.projects; }",
  "@/lib/start-my-day/load": "export async function loadDayPlan() { return {projects: []}; }",
  "@/lib/start-my-day/lock":
    "export async function withDayStartLock(userId, fn) { return state.locked ? null : fn(); }",
  "@/lib/fleet-kick":
    "export async function kickFleet(userId, options) { state.calls.push({userId, options}); return {ok:true,kicked:1,details:[{projectKey:'Loki',outcome:'kicked'}]}; }",
};

async function main() {
  const bundled = await build({
    entryPoints: ["src/app/api/control/start-my-day/route.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    plugins: [
      {
        name: "day-test-seams",
        setup(b) {
          b.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const module = {
    exports: {} as { POST: (req: Request) => Promise<Response>; GET: () => Promise<Response> },
  };
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    state,
    console,
    process,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Buffer,
    setTimeout,
    clearTimeout,
  });
  const post = (body: unknown) =>
    module.exports.POST(
      new Request("http://localhost/api/control/start-my-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  state.userId = null;
  assert.equal((await post({ projectIds: [state.projects[0].id] })).status, 401);
  assert.equal((await module.exports.GET()).status, 401);
  state.userId = "owner";
  for (const body of [
    null,
    {},
    { projectIds: [] },
    { projectIds: ["not-a-uuid"] },
    { projectIds: [state.projects[0].id, state.projects[0].id] },
    { projectIds: ["00000000-0000-4000-8000-000000000099"] },
    { projectIds: Array(4).fill(state.projects[0].id) },
  ]) {
    assert.equal((await post(body)).status, 400);
  }
  state.locked = true;
  assert.equal((await post({ projectIds: [state.projects[0].id] })).status, 409);
  assert.equal(state.calls.length, 0, "no rejected request may dispatch");
  state.locked = false;
  const result = await post({ projectIds: [state.projects[0].id], projectKeys: ["other-owner"] });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).result.kicked, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.calls)),
    [
      {
        userId: "owner",
        options: { source: "start_my_day", projectKeys: ["Loki"], requireFleetOn: false },
      },
    ],
    "dispatch only the name resolved from an owned ID, even when the browser supplies names",
  );
  console.log("✓ start-my-day route auth, validation, scope and dispatch tests passed");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
