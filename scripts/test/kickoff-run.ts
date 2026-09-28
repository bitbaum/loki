/**
 * The "Make it happen" run (lib/kickoff-run.ts), against a scripted server.
 *
 * Pinned from a real phone session (2026-09-28): the profile step failed on a
 * model error, the person went to Terminal to watch, and came back to a card
 * that had forgotten the run while no agent ever started. These cases are the
 * promises that session broke:
 *
 *   - a failed profile step does not stop the repository or the agent;
 *   - "queued with no builder" is reported as queued, not as working;
 *   - a failed repository step does not dispatch an agent with nowhere to write;
 *   - the run is readable by the Terminal's name for the project.
 *
 * Run: npx tsx scripts/test/kickoff-run.ts
 */
import { clearKickoffRun, getKickoffRun, startKickoff } from "@/lib/kickoff-run";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Reply = { status: number; body: Record<string, unknown> };
let calls: string[] = [];

function serve(routes: Record<string, Reply>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const step = url.split("/").pop()!;
    calls.push(step);
    const reply = routes[step] ?? { status: 500, body: { error: `unscripted ${step}` } };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
}

const ok = (body: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { ok: true, ...body },
});
const REPO = ok({ repo: { full_name: "bitbaum/zurich" }, template: "nextjs-tailwind" });
const CD = ok({ registered: true, liveUrl: "https://zurich.orangecat.ch" });

let passed = 0;
async function check(label: string, fn: () => Promise<void>) {
  clearKickoffRun("p1");
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const base = {
  names: ["zurich-sublet", "Zurich Sublet Compliance & Concierge Service"],
  source: "A concierge that keeps Zurich sublets legal.",
  visibility: "private" as const,
};

async function main() {
  await check("a failed profile step still creates the repo and starts the agent", async () => {
    serve({
      brief: { status: 502, body: { error: "Your brief is saved, but the AI could not…" } },
      provision: REPO,
      "register-cd": CD,
      dispatch: ok({ mode: "direct" }),
    });
    await startKickoff("p1", { ...base, plan: ["profile", "repo", "dispatch"] });
    const run = getKickoffRun("p1")!;
    assert(calls.join() === "brief,provision,register-cd,dispatch", `wrong order: ${calls}`);
    assert(run.steps[0]!.state === "failed", "profile failure was hidden");
    assert(run.steps[1]!.state === "done", "repo did not land");
    assert(run.dispatch === "running", `agent not reported running: ${run.dispatch}`);
    assert(!run.running && run.finished, "run never settled");
  });

  await check("no builder online reads as queued, never as working", async () => {
    serve({ dispatch: ok({ mode: "queued", warning: "runner-offline" }) });
    await startKickoff("p1", { ...base, plan: ["dispatch"] });
    const run = getKickoffRun("p1")!;
    assert(run.dispatch === "queued-offline", `offline laundered: ${run.dispatch}`);
    assert(/no builder/i.test(run.steps[0]!.note ?? ""), "note does not say why it waits");
  });

  await check("a failed repository step does not dispatch", async () => {
    serve({ provision: { status: 400, body: { error: "No GitHub account linked." } } });
    await startKickoff("p1", { ...base, plan: ["repo", "dispatch"] });
    const run = getKickoffRun("p1")!;
    assert(!calls.includes("dispatch"), "dispatched with no repository");
    assert(run.steps[1]!.state === "failed", "dispatch left pending forever");
    assert(run.dispatch === "not-sent", `wrong outcome: ${run.dispatch}`);
  });

  await check("a network drop names itself instead of spinning", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await startKickoff("p1", { ...base, plan: ["dispatch"] });
    const run = getKickoffRun("p1")!;
    assert(run.steps[0]!.state === "failed", "network error left the step running");
    assert(run.dispatch === "failed", `wrong outcome: ${run.dispatch}`);
  });

  await check("a second press while running does not start a second run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let dispatches = 0;
    globalThis.fetch = (async () => {
      dispatches += 1;
      await gate;
      return new Response(JSON.stringify({ ok: true, mode: "direct" }), { status: 200 });
    }) as typeof fetch;
    const first = startKickoff("p1", { ...base, plan: ["dispatch"] });
    await startKickoff("p1", { ...base, plan: ["dispatch"] });
    release();
    await first;
    assert(dispatches === 1, `dispatched ${dispatches} agents`);
  });

  console.log(`\n✓ kickoff-run: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
