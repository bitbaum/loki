// The gateway-down alert: what counts as down, and when the flag goes up and
// down. A week of silence (2026-10-08 → 10-15) is what this pins against.
import assert from "node:assert/strict";
import { gatewayTransition, probeGateway } from "../../src/lib/gateway-health";

async function main() {
  // Any HTTP answer is "up" — including an auth wall and an error page.
  for (const status of [200, 401, 404, 500]) {
    const r = await probeGateway("http://x", async () => new Response("", { status }));
    assert.equal(r.up, true, `${status} means the process answered`);
    assert.equal(r.detail, `HTTP ${status}`);
  }

  // A refused connection (the real failure: ECONNREFUSED on :18789) is "down",
  // and says why in the cause's words.
  const refused = await probeGateway("http://x", async () => {
    throw new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:18789"),
    });
  });
  assert.equal(refused.up, false);
  assert.match(refused.detail, /ECONNREFUSED/);

  // A hang is down too, not a hung cron.
  const t0 = Date.now();
  const hung = await probeGateway(
    "http://x",
    (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("timed out")));
      }),
    50,
  );
  assert.equal(hung.up, false);
  assert.ok(Date.now() - t0 < 2000, "the probe gives up on its own timeout");

  // The transition table: raise once, clear when it recovers, otherwise nothing.
  assert.equal(gatewayTransition(false, false), "raise", "down, no flag → raise");
  assert.equal(gatewayTransition(false, true), "none", "down, already flagged → stay quiet");
  assert.equal(gatewayTransition(true, true), "clear", "up again → the flag falls");
  assert.equal(gatewayTransition(true, false), "none", "healthy → nothing");

  console.log("gateway-health: ok");
}
main();
