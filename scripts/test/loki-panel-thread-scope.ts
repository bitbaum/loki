/**
 * The floating assistant's thread is kept per person and per project
 * (lib/loki/panel-thread.ts).
 *
 * Agreed in the 2026-10-31 dogfooding round, with the objection that shaped
 * it: a single persisted thread would carry project A's questions into
 * project B's context. So: two turns on A, open B — nothing; back to A — the
 * two turns, ready to go as history.
 * Run: npx tsx scripts/test/loki-panel-thread-scope.ts
 */
import assert from "node:assert/strict";
import {
  clearPanelThread,
  FLEET_SCOPE,
  PANEL_THREAD_LIMIT,
  panelThreadKey,
  readPanelThread,
  writePanelThread,
  type PanelTurn,
} from "../../src/lib/loki/panel-thread";

const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

// One key per person and scope; the fleet-wide pages share one.
assert.equal(panelThreadKey("u1", "bakery"), "loki:ask:u1:bakery");
assert.equal(panelThreadKey("u1", null), `loki:ask:u1:${FLEET_SCOPE}`);
assert.notEqual(panelThreadKey("u1", "bakery"), panelThreadKey("u2", "bakery"));
assert.notEqual(panelThreadKey("u1", "bakery"), panelThreadKey("u1", "shop"));

const a = panelThreadKey("u1", "bakery");
const b = panelThreadKey("u1", "shop");
const turns: PanelTurn[] = [
  { role: "user", text: "How is the bakery doing?" },
  {
    role: "loki",
    text: "Three open reports [F1].",
    replies: ["Show them"],
    meta: { via: "tool-loop" },
  },
];
writePanelThread(a, turns);
assert.deepEqual(readPanelThread(a), turns, "A restores its two turns");
assert.deepEqual(readPanelThread(b), [], "B starts with nothing of A's");
assert.deepEqual(
  readPanelThread(panelThreadKey("u2", "bakery")),
  [],
  "another person sees none of it",
);

// Capped, newest kept.
const many = Array.from({ length: PANEL_THREAD_LIMIT + 5 }, (_, i) => ({
  role: "user" as const,
  text: `turn ${i}`,
}));
writePanelThread(a, many);
const kept = readPanelThread(a);
assert.equal(kept.length, PANEL_THREAD_LIMIT);
assert.equal(kept[kept.length - 1].text, `turn ${PANEL_THREAD_LIMIT + 4}`);

// A broken or foreign value reads as an empty thread, never a crash.
store.set(a, "{not json");
assert.deepEqual(readPanelThread(a), []);
store.set(a, JSON.stringify([{ role: "system", text: "x" }, { role: "user" }, null]));
assert.deepEqual(readPanelThread(a), []);

// Cleared is gone.
writePanelThread(a, turns);
clearPanelThread(a);
assert.equal(store.has(a), false);
assert.deepEqual(readPanelThread(a), []);

console.log("loki-panel-thread-scope: ok");
