// The widget's one conversation, as data (widget/thread.ts): who answers on
// which embed, a stored thread restored only as far as it validates (anything
// on the host page can write sessionStorage), and the thread said back to the
// model as history — receipts included, so "and the footer too" has context.
// Run: npx tsx scripts/test/widget-thread.ts
import assert from "node:assert/strict";
import {
  assistantFor,
  historyFor,
  pushItem,
  restoreThread,
  THREAD_MAX,
  THREAD_MAX_AGE_MS,
  type ThreadItem,
} from "../../widget/thread";
import { CHAT_MAX_HISTORY, CHAT_MAX_MESSAGE } from "../../widget/loki-api";
import { parseWidgetSurfaceModes } from "../../widget/surface-modes";
import { readFileSync } from "node:fs";

// Read, not imported: the route module opens the database on import.
const chatRoute = readFileSync("src/app/api/widget/chat/route.ts", "utf8");
const routeCap = (name: string) =>
  Number(new RegExp(`export const ${name} = (\\d+)`).exec(chatRoute)?.[1]);
const WIDGET_CHAT_MAX_MESSAGE = routeCap("WIDGET_CHAT_MAX_MESSAGE");
const WIDGET_CHAT_MAX_HISTORY = routeCap("WIDGET_CHAT_MAX_HISTORY");

// ---- who answers ----
assert.equal(
  assistantFor(parseWidgetSurfaceModes(null), false),
  "advisor",
  "default: the site advisor",
);
assert.equal(assistantFor(parseWidgetSurfaceModes("chat,report"), false), "concierge");
assert.equal(
  assistantFor(parseWidgetSurfaceModes("report"), false),
  "none",
  "report-only opts out of AI",
);
assert.equal(
  assistantFor(parseWidgetSurfaceModes("report"), true),
  "advisor",
  "the owner always gets advice",
);
assert.equal(
  assistantFor(parseWidgetSurfaceModes("chat"), true),
  "advisor",
  "even on a front desk",
);
assert.deepEqual(parseWidgetSurfaceModes("chat, report, chat, nonsense"), ["chat", "report"]);
assert.deepEqual(parseWidgetSurfaceModes("nonsense"), ["report", "ask"]);

// ---- restoring a stored thread ----
{
  const now = 50_000_000;
  const restored = restoreThread(
    [
      { kind: "you", at: now - 1000, text: "Is the menu ok?" },
      {
        kind: "loki",
        at: now - 900,
        text: "Mostly.",
        speaker: "cat",
        changes: ["Shorten it", 7, "x".repeat(900)],
        links: [
          { label: "OK", url: "https://example.org/a" },
          { label: "evil", url: "javascript:alert(1)" },
        ],
      },
      {
        kind: "sent",
        at: now - 800,
        text: "Shorten it",
        owner: true,
        building: true,
        claimUrl: "data:x",
      },
      { kind: "you", at: now - THREAD_MAX_AGE_MS - 1, text: "from an earlier visit" },
      { kind: "you", at: now + 60_000, text: "from the future" },
      { kind: "you", at: now - 10, text: "   " },
      { kind: "admin", at: now - 10, text: "forged" },
      null,
      "nonsense",
    ],
    now,
  );
  assert.equal(restored.length, 3, `only valid, fresh items survive (${JSON.stringify(restored)})`);
  const loki = restored[1] as Extract<ThreadItem, { kind: "loki" }>;
  assert.equal(loki.speaker, "cat");
  assert.equal(loki.changes?.length, 2, "non-string changes dropped");
  assert.equal(loki.changes?.[1].length, 300, "a long change is capped");
  assert.deepEqual(
    loki.links,
    [{ label: "OK", url: "https://example.org/a" }],
    "only http(s) links",
  );
  const sent = restored[2] as Extract<ThreadItem, { kind: "sent" }>;
  assert.equal(sent.claimUrl, undefined, "a non-http claim link is dropped");
  assert.equal(sent.building, true);
  assert.deepEqual(restoreThread("not an array", now), []);
}

// ---- Loki's remarks survive a reload, and need their fix to be a remark ----
{
  const now = 50_000_000;
  const r = restoreThread(
    [
      {
        kind: "noticed",
        at: now - 5,
        text: "It found nothing there (404).",
        fix: "Fix /hours",
        filed: true,
      },
      { kind: "noticed", at: now - 4, text: "No fix to send" },
      {
        kind: "noticed",
        at: now - 3,
        text: "The page has no main heading.",
        fix: "Add one",
        key: "/p|checks|The page has no main heading (h#)",
        again: true,
      },
    ],
    now,
  );
  assert.deepEqual(r, [
    {
      kind: "noticed",
      at: now - 5,
      text: "It found nothing there (404).",
      fix: "Fix /hours",
      filed: true,
    },
    {
      kind: "noticed",
      at: now - 3,
      text: "The page has no main heading.",
      fix: "Add one",
      key: "/p|checks|The page has no main heading (h#)",
      again: true,
    },
  ]);
  assert.match(historyFor(r, 4, 200)[0].content, /^\(Noticed while watching: /);
}

// ---- bounded ----
{
  let t: ThreadItem[] = [];
  for (let i = 0; i < THREAD_MAX + 7; i++) t = pushItem(t, { kind: "you", at: i, text: `m${i}` });
  assert.equal(t.length, THREAD_MAX);
  assert.equal((t[0] as { text: string }).text, "m7", "the oldest go first");
}

// ---- the thread as model history ----
{
  const t: ThreadItem[] = [
    { kind: "you", at: 1, text: "Change the title" },
    { kind: "loki", at: 2, text: "Try “Your pharmacy”." },
    { kind: "sent", at: 3, text: "Use “Your pharmacy” as the title", owner: true },
    { kind: "you", at: 4, text: "and the footer too" },
  ];
  const h = historyFor(t, 3, 20);
  assert.deepEqual(
    h.map((x) => x.role),
    ["assistant", "assistant", "user"],
    "the last N turns",
  );
  assert.ok(h[1].content.startsWith("(Sent to the bu"), "a receipt is said back as Loki's");
  assert.ok(
    h.every((x) => x.content.length <= 20),
    "each turn is capped",
  );
}

// ---- the widget clamps to what the chat route accepts ----
assert.equal(CHAT_MAX_MESSAGE, WIDGET_CHAT_MAX_MESSAGE, "chat message cap mirrors the route");
assert.equal(CHAT_MAX_HISTORY, WIDGET_CHAT_MAX_HISTORY, "chat history cap mirrors the route");

console.log("widget-thread: ok");
