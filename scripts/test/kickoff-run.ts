/**
 * "Make it happen" — the sequence (lib/kickoff/orchestrate) and the server's
 * ownership of it (lib/kickoff/server-runs), against a scripted set of steps.
 *
 * Pinned from a real phone session (2026-09-28): the profile step failed on a
 * model error, the person went to Terminal to watch, and came back to a card
 * that had forgotten the run while no agent ever started. These cases are the
 * promises that session broke:
 *
 *   - a failed profile step does not stop the repository or the agent;
 *   - "queued with no builder" is reported as queued, not as working;
 *   - a failed repository step does not dispatch an agent with nowhere to write;
 *   - a second press / tab / device JOINS the running kickoff, never a second agent;
 *   - the run finishes on the server with nobody watching it.
 *
 * Run: npx tsx scripts/test/kickoff-run.ts
 */
import { runKickoffPlan, type KickoffCall, type KickoffRunState } from "@/lib/kickoff/orchestrate";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Reply = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { ok: true, ...body },
});
const REPO = ok({ repo: { full_name: "bitbaum/zurich" }, template: "nextjs-tailwind" });
const CD = ok({ registered: true, liveUrl: "https://zurich.orangecat.ch" });

function script(routes: Record<string, Reply | (() => Promise<Reply>)>) {
  const calls: string[] = [];
  const call: KickoffCall = async (path) => {
    calls.push(path);
    const reply = routes[path];
    if (!reply) return { status: 500, body: { error: `unscripted ${path}` } };
    return typeof reply === "function" ? reply() : reply;
  };
  return { call, calls };
}

const base = {
  projectId: "p1",
  names: ["zurich-sublet", "Zurich Sublet Compliance & Concierge Service"],
  source: "A concierge that keeps Zurich sublets legal.",
  visibility: "private" as const,
};

let passed = 0;
async function check(label: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function main() {
  await check("a failed profile step still creates the repo and starts the agent", async () => {
    const { call, calls } = script({
      brief: { status: 502, body: { error: "Your brief is saved, but the AI could not…" } },
      provision: REPO,
      "register-cd": CD,
      dispatch: ok({ mode: "direct" }),
    });
    const run = await runKickoffPlan(
      { ...base, plan: ["profile", "repo", "dispatch"] },
      call,
      () => {},
    );
    assert(calls.join() === "brief,provision,register-cd,dispatch", `wrong order: ${calls}`);
    assert(run.steps[0]!.state === "failed", "profile failure was hidden");
    assert(run.steps[1]!.state === "done", "repo did not land");
    assert(run.deployment?.liveUrl === "https://zurich.orangecat.ch", "deployment not carried");
    assert(run.dispatch === "running", `agent not reported running: ${run.dispatch}`);
    assert(!run.running && run.finished && run.finishedAt, "run never settled");
  });

  await check(
    "every change is emitted, and the first emit is before any step answers",
    async () => {
      const seen: KickoffRunState[] = [];
      const { call } = script({ dispatch: ok({ mode: "direct" }) });
      const pending = runKickoffPlan({ ...base, plan: ["dispatch"] }, call, (r) => seen.push(r));
      assert(seen.length >= 1 && seen[0]!.running, "no synchronous first snapshot");
      await pending;
      assert(
        seen.some((r) => r.steps[0]!.state === "running"),
        "running state never emitted",
      );
      assert(!seen.at(-1)!.running, "last emit is not the settled run");
    },
  );

  await check("no builder online reads as queued, never as working", async () => {
    const { call } = script({ dispatch: ok({ mode: "queued", warning: "runner-offline" }) });
    const run = await runKickoffPlan({ ...base, plan: ["dispatch"] }, call, () => {});
    assert(run.dispatch === "queued-offline", `offline laundered: ${run.dispatch}`);
    assert(/no builder/i.test(run.steps[0]!.note ?? ""), "note does not say why it waits");
  });

  await check("a failed repository step does not dispatch", async () => {
    const { call, calls } = script({
      provision: { status: 400, body: { error: "No GitHub account linked." } },
    });
    const run = await runKickoffPlan({ ...base, plan: ["repo", "dispatch"] }, call, () => {});
    assert(!calls.includes("dispatch"), "dispatched with no repository");
    assert(run.steps[1]!.state === "failed", "dispatch left pending forever");
    assert(run.dispatch === "not-sent", `wrong outcome: ${run.dispatch}`);
  });

  await check("a step that throws is reported, the run still settles", async () => {
    const run = await runKickoffPlan(
      { ...base, plan: ["dispatch"] },
      async () => {
        throw new Error("db down");
      },
      () => {},
    );
    assert(run.steps[0]!.state === "failed", "a throw left the step running");
    assert(run.dispatch === "failed" && run.finished, `wrong outcome: ${run.dispatch}`);
  });

  // server-runs imports the real step functions, which import @/db; that
  // module only needs a URL at init and never connects for these cases.
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
  const { startServerKickoff, getServerKickoff, findServerKickoffByName } =
    await import("@/lib/kickoff/server-runs");

  await check("a second start joins the running kickoff instead of a second agent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let dispatches = 0;
    const call: KickoffCall = async () => {
      dispatches += 1;
      await gate;
      return ok({ mode: "direct" });
    };
    const first = startServerKickoff("u1", { ...base, plan: ["dispatch"] }, call);
    const second = startServerKickoff("u1", { ...base, plan: ["dispatch"] }, call);
    assert(!first.joined && second.joined, "second press did not join");
    assert(first.run.running, "first snapshot is not running");
    release();
    await first.done;
    assert(dispatches === 1, `dispatched ${dispatches} agents`);
  });

  await check("the run finishes on the server with nobody polling it", async () => {
    const { call } = script({ dispatch: ok({ mode: "queued", warning: "runner-offline" }) });
    const { done } = startServerKickoff("u2", { ...base, plan: ["dispatch"] }, call);
    await done;
    const run = getServerKickoff("u2", "p1");
    assert(run && run.finished && run.dispatch === "queued-offline", "run not recorded");
    const byName = findServerKickoffByName(
      "u2",
      "  zurich sublet compliance & concierge service ".trim(),
    );
    assert(byName?.projectId === "p1", "Terminal cannot find it by name");
    assert(
      findServerKickoffByName("someone-else", "zurich-sublet") === null,
      "leaked across users",
    );
  });

  console.log(`\n✓ kickoff-run: ${passed} passed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
