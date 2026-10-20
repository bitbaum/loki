/**
 * "New chat" always does something you can see.
 *
 * 2026-10-20, Loki watch mode on /loki: "I pressed New chat three times and
 * nothing happened." On the start page, leaving the thread changes nothing,
 * so the half-typed draft stayed and the cursor stayed wherever it was. Every
 * press now empties the box — including the start page's stored draft, which
 * the box would otherwise restore — and puts the cursor in it
 * (hooks/use-new-chat.ts). Back on a phone only leaves: no keyboard, draft kept.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearLokiDraft,
  lokiDraftKey,
  readLokiDraft,
  writeLokiDraft,
} from "../../src/lib/loki/draft";

const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

// The press itself, outside React: what `start` does before the state bump.
const hook = readFileSync("src/hooks/use-new-chat.ts", "utf8");
const body = hook.slice(hook.indexOf("const start = () => {"), hook.indexOf("return { fresh"));
const order = ["clearLokiDraft(lokiDraftKey(null))", "leave()", "closeChats()", "setFresh("];
let at = -1;
for (const step of order) {
  const i = body.indexOf(step);
  assert.ok(i > at, `New chat must run ${step} — and in this order: ${order.join(" → ")}`);
  at = i;
}

// Clearing the start page's key is what stops the box restoring the old words.
writeLokiDraft(lokiDraftKey(null), "half a thought from before");
clearLokiDraft(lokiDraftKey(null));
assert.equal(readLokiDraft(lokiDraftKey(null)), "", "the start page draft is gone after New chat");

// The composer empties itself and takes the cursor on every bump.
const composer = readFileSync("src/components/loki/Composer.tsx", "utf8");
assert.match(composer, /freshRequest !== appliedFresh/, "composer must react to every press");
assert.match(composer, /setTextState\(""\)/, "composer must empty the box");
assert.match(composer, /textareaRef\.current\?\.focus\(\)/, "composer must take the cursor");

// Every "New chat" button goes through the hook; Back does not.
const workspace = readFileSync("src/components/loki/LokiWorkspace.tsx", "utf8");
assert.match(workspace, /onNew=\{newChat\.start\}/, "the rail's New chat");
assert.match(workspace, /onNewChat=\{newChat\.start\}/, "the top bar's and thread menu's New chat");
assert.match(workspace, /freshRequest=\{newChat\.fresh\}/, "the composer hears the press");
const chrome = readFileSync("src/components/loki/WorkspaceChrome.tsx", "utf8");
assert.match(chrome, /onBack=\{onLeaveThread\}/, "Back leaves the thread without a fresh box");

console.log("loki-new-chat-starts-blank: ok");
