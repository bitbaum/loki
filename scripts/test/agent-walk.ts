/**
 * The scripted agent walk files with the seat's Bearer token, polls statusUrl,
 * shows every canonical state, never prints the token and never dispatches.
 * Run: npx tsx scripts/test/agent-walk.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs script
import { walk } from "../walk/agent-walk.mjs";

const TOKEN = "ck_secret_token_value";
const origin = "https://loki.example";
const states = ["queued", "starting", "working", "needs_you", "done"];
let polls = 0;
const calls: { url: string; auth: string | null; body?: string }[] = [];

const fetchImpl = async (url: string | URL, init: RequestInit = {}) => {
  const u = String(url);
  const h = init.headers as Record<string, string>;
  calls.push({ url: u, auth: h.Authorization, body: init.body as string | undefined });
  if (init.method === "POST")
    return new Response(
      JSON.stringify({
        id: "f1",
        status: "new",
        statusUrl: `${origin}/api/feedback/f1/status`,
        building: false,
      }),
      { status: 201 },
    );
  const state = states[Math.min(polls++, states.length - 1)];
  return new Response(JSON.stringify({ id: "f1", state, label: state }));
};

async function main() {
  const out: string[] = [];
  const code = await walk(
    { LOKI_SEAT_TOKEN: TOKEN, LOKI_PROJECT_ID: "p1", LOKI_URL: origin },
    { fetchImpl, sleep: async () => {}, log: (l: string) => out.push(l) },
  );
  assert.equal(code, 0);
  for (const s of states)
    assert.ok(
      out.some((l) => l.startsWith(s)),
      `shows ${s}`,
    );
  assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.ok(!out.join("\n").includes(TOKEN), "token never printed");
  assert.ok(
    calls.every((c) => !c.url.includes("dispatch")),
    "never dispatches",
  );
  assert.equal(JSON.parse(calls[0].body!).agentName, "QA · quality control");

  // A statusUrl on another origin never receives the token.
  const evil = await walk(
    { LOKI_SEAT_TOKEN: TOKEN, LOKI_PROJECT_ID: "p1", LOKI_URL: origin },
    {
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "f", statusUrl: "https://evil.example/s" }), {
          status: 201,
        }),
      sleep: async () => {},
      log: () => {},
    },
  );
  assert.equal(evil, 3);
  assert.doesNotMatch(
    readFileSync("scripts/walk/agent-walk.mjs", "utf8"),
    /console\.log\(.*token/i,
  );
  console.log("agent-walk ok");
}
void main();
