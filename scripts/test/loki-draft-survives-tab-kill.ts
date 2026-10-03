/**
 * The Loki composer draft survives a discarded tab.
 *
 * 2026-10-03, from a phone: tap the paperclip, Android opens a picker, come
 * back to "Zu wenig Speicher für vorherige Operation" and an empty composer.
 * The thread was in the URL; the words were React state. The draft is now
 * mirrored to localStorage per thread (lib/loki/draft.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearLokiDraft,
  lokiDraftKey,
  readLokiDraft,
  writeLokiDraft,
} from "../../src/lib/loki/draft";

// One key per thread; the start page has its own.
assert.equal(lokiDraftKey(null), "loki:draft:new");
assert.equal(lokiDraftKey("abc"), "loki:draft:abc");
assert.notEqual(lokiDraftKey(null), lokiDraftKey("abc"));

// A minimal localStorage, the way a browser would hand it over.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const key = lokiDraftKey("t1");
writeLokiDraft(key, "use it to improve it. Ultimate dogfood");
assert.equal(readLokiDraft(key), "use it to improve it. Ultimate dogfood");

// Whitespace is not a draft: a cleared box must not come back as one space.
writeLokiDraft(key, "   ");
assert.equal(store.has(key), false);
assert.equal(readLokiDraft(key), "");

writeLokiDraft(key, "again");
clearLokiDraft(key);
assert.equal(readLokiDraft(key), "");

// Storage that throws (private window, full quota) costs nothing but persistence.
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: () => {
      throw new Error("quota");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("quota");
    },
  },
};
assert.doesNotThrow(() => writeLokiDraft(key, "x"));
assert.equal(readLokiDraft(key), "");

// The wiring: the composer mirrors every keystroke and restores on mount, and
// the workspace clears the draft under the key it was WRITTEN in when it is
// sent — a first message moves the composer to the new thread's key, so the
// composer's own clear-after-send alone would strand the start-page draft.
const composer = readFileSync("src/components/loki/Composer.tsx", "utf8");
assert.match(composer, /readLokiDraft\(draftKey\)/, "composer must restore the draft on mount");
assert.match(composer, /writeLokiDraft\(draftKey, next\)/, "composer must mirror each change");
const workspace = readFileSync("src/components/loki/LokiWorkspace.tsx", "utf8");
assert.match(workspace, /draftKey=\{lokiDraftKey\(activeId\)\}/, "draft is keyed by thread");
assert.match(
  workspace,
  /clearLokiDraft\(lokiDraftKey\(activeId\)\)/,
  "send must clear the draft under the key it was written in",
);

console.log("loki-draft-survives-tab-kill: ok");
