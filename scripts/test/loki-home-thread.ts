/**
 * A link into the chat that names a project opens that project's recent
 * thread, instead of an empty start screen whose next message mints another.
 */
import assert from "node:assert/strict";
import { HOME_THREAD_MAX_AGE_MS, initialThreadId } from "../../src/lib/loki/conversation-param";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const A = "aaaaaaaa-1111-4222-8333-444455556666";
const B = "bbbbbbbb-1111-4222-8333-444455556666";
const C = "cccccccc-1111-4222-8333-444455556666";
const list = [
  { id: A, projectKeys: ["loki"], updatedAt: ago(1) },
  { id: B, projectKeys: ["Loki", "kivvi"], updatedAt: ago(0.1) },
  { id: C, projectKeys: ["datacat"], updatedAt: ago(30) },
];
const at = (over: Partial<Parameters<typeof initialThreadId>[0]>) =>
  initialThreadId({ c: null, project: null, q: null, conversations: list, now: NOW, ...over });

// ?c= always wins.
assert.equal(at({ c: C, project: "loki" }), C);
// A project link opens its newest thread, case-insensitively.
assert.equal(at({ project: "loki" }), B);
assert.equal(at({ project: "KIVVI" }), B);
// Past two weeks it is history: start fresh.
assert.equal(at({ project: "datacat" }), null);
assert.equal(
  initialThreadId({
    c: null,
    project: "datacat",
    q: null,
    conversations: [
      {
        id: C,
        projectKeys: ["datacat"],
        updatedAt: new Date(NOW - HOME_THREAD_MAX_AGE_MS + 1000).toISOString(),
      },
    ],
    now: NOW,
  }),
  C,
);
// A prefilled ask is a beginning: leave it on the start screen.
assert.equal(at({ project: "loki", q: "add a pricing page" }), null);
// No project, an unknown project, or no list yet: nothing to open.
assert.equal(at({}), null);
assert.equal(at({ project: "nope" }), null);
assert.equal(at({ project: "loki", conversations: undefined }), null);

console.log("✓ loki home thread");
