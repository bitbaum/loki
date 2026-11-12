/**
 * A run's delivery floor is never later than the agent's own handoff for that
 * task, even when the runner does not say when it typed the prompt.
 *
 * Live 2026-11-12 17:00: the probe to orangecat was claimed at 16:59:5x, Claude
 * did it and wrote its handoff at 17:00:00, and the runner (still on the
 * morning's code, its update held by the drain) acked at 17:00:05 without its
 * injection time. deliveredAt was the ack time, the handoff "predated" it,
 * and closeRunFromSession left the run at Needs you.
 *
 * Run: npx tsx scripts/test/delivery-claim-floor.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closeRunFromSession, deliveryStampFor } from "@/lib/orchestration/close-from-session";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
console.log("delivery-claim-floor:");

const started = new Date("2026-11-12T16:59:47Z");
const claimed = "2026-11-12T16:59:50.000Z";
const ack = Date.parse("2026-11-12T17:00:05.682Z");
const handoff = Date.parse("2026-11-12T17:00:00Z");

t("the claim time is accepted as the delivery stamp", () => {
  assert.equal(deliveryStampFor(claimed, started, ack), claimed);
});

t("with the claim time, the agent's handoff closes its run", () => {
  const run = {
    id: "r",
    finishedAt: null,
    startedAt: started,
    payload: { deliveredAt: deliveryStampFor(claimed, started, ack) },
  };
  const patch = closeRunFromSession(
    run as never,
    {
      status: "ready",
      done: "e2e ok — no changes",
      mtime: handoff,
    } as never,
  );
  assert.ok(patch, "the run closes");
});

t("with the ack time, as before, it did not (the bug)", () => {
  const run = {
    id: "r",
    finishedAt: null,
    startedAt: started,
    payload: { deliveredAt: new Date(ack).toISOString() },
  };
  const patch = closeRunFromSession(
    run as never,
    {
      status: "ready",
      done: "e2e ok — no changes",
      mtime: handoff,
    } as never,
  );
  assert.equal(patch, null);
});

const route = readFileSync("src/app/api/control/commands/[id]/route.ts", "utf8");
t("the ack route falls back to the command's claim time", () => {
  assert.match(route, /deliveredAt \?\? command\?\.claimedAt\?\.toISOString\(\)/);
});

console.log(`  ${passed} passed`);
