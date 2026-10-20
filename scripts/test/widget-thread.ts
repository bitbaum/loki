// The widget's one conversation, as data (widget/thread.ts): who answers on
// which embed, a stored thread restored only as far as it validates (anything
// on the host page can write sessionStorage), and the thread said back to the
// model as history — receipts included, so "and the footer too" has context.
// Run: npx tsx scripts/test/widget-thread.ts
import assert from "node:assert/strict";
import {
  assistantFor,
  dropNoticed,
  historyFor,
  isPageReadKey,
  noticeSlot,
  pushItem,
  pushNoticed,
  pushPageRead,
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
      {
        kind: "sent",
        at: now - 790,
        text: "The panel covers the keyboard",
        owner: false,
        toLoki: true,
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
  assert.equal(restored.length, 4, `only valid, fresh items survive (${JSON.stringify(restored)})`);
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
  const toLoki = restored[3] as Extract<ThreadItem, { kind: "sent" }>;
  assert.equal(toLoki.toLoki, true, "a note about Loki itself is remembered as such");
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

// ---- Loki's unasked page reads: only the newest stays ----
{
  // 2026-10-15: one read per page browsed, four stacked above the owner's own
  // words. A new read replaces the last; every other item is untouched.
  const read = (at: number, key: string): ThreadItem => ({
    kind: "noticed",
    at,
    text: `read ${at}`,
    fix: "f",
    key,
  });
  let t: ThreadItem[] = [];
  t = pushPageRead(t, read(1, "/a|read"));
  t = pushItem(t, { kind: "noticed", at: 2, text: "slow", fix: "f", key: "/a|notice|slow" });
  t = pushItem(t, { kind: "you", at: 3, text: "hello" });
  t = pushPageRead(t, read(4, "/b|read"));
  assert.deepEqual(
    t.map((i) => i.at),
    [2, 3, 4],
    "the earlier read goes; a measured notice and your words stay",
  );
  assert.ok(
    isPageReadKey("/b|read") && !isPageReadKey("/a|notice|slow") && !isPageReadKey(undefined),
  );
}

// ---- one card per finding: a new reading updates it, never stacks ----
{
  // 2026-10-20, operator's phone on /voice: "no main title" three times in
  // one panel, "1 form field has no label" beside "2 form fields have no
  // label". A page's checks own ONE card; each reading replaces it in place.
  const checks = (
    at: number,
    kinds: string,
    text: string,
  ): Extract<ThreadItem, { kind: "noticed" }> => ({
    kind: "noticed",
    at,
    text,
    fix: "f",
    key: `/voice|checks|${kinds}`,
  });
  let t: ThreadItem[] = [];
  t = pushNoticed(t, checks(1, "The page's main heading (h1)", "no main title"));
  t = pushItem(t, { kind: "you", at: 2, text: "hello" });
  t = pushNoticed(
    t,
    checks(3, "The page's main heading (h1)|# form field(s) have no label", "two things"),
  );
  t = pushNoticed(t, checks(4, "# form field(s) have no label", "one field"));
  assert.deepEqual(
    t.map((i) => `${i.at}:${i.kind}`),
    ["4:noticed", "2:you"],
    "the card keeps its place and shows only the newest reading",
  );
  // The same words again (a reload): nothing changes.
  assert.equal(pushNoticed(t, checks(4, "# form field(s) have no label", "one field")), t);
  // Another page's checks are another card.
  t = pushNoticed(t, {
    kind: "noticed",
    at: 5,
    text: "other page",
    fix: "f",
    key: "/loki|checks|x",
  });
  assert.equal(t.filter((i) => i.kind === "noticed").length, 2);
  // A remark whose words are already on screen is not said twice.
  const slow = { kind: "noticed" as const, at: 6, text: "It took 4s", fix: "f", key: "/a|slow|x" };
  t = pushNoticed(t, slow);
  assert.equal(pushNoticed(t, { ...slow, at: 7, key: "/b|slow|y" }).length, t.length);
  // A clean reading takes the page's card back.
  assert.equal(noticeSlot("/voice|checks|# form field(s) have no label"), "/voice|checks");
  assert.equal(noticeSlot("/voice|fail|request:x"), "/voice|fail|request:x");
  const dropped = dropNoticed(t, "/voice|checks");
  assert.deepEqual(
    dropped.map((i) => i.at),
    [2, 5, 6],
    "only that page's card goes",
  );
  assert.equal(dropNoticed(dropped, "/voice|checks"), dropped, "nothing to drop: same thread");
  // Reads keep their own rule: one read at a time.
  t = pushNoticed(t, { kind: "noticed", at: 8, text: "read a", fix: "f", key: "/a|read" });
  t = pushNoticed(t, { kind: "noticed", at: 9, text: "read b", fix: "f", key: "/b|read" });
  assert.equal(t.filter((i) => i.kind === "noticed" && isPageReadKey(i.key)).length, 1);
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
