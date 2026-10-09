// "Continue in Loki": the widget's conversation can be carried into Loki's
// chat on the project (the thread in the composer) or the project's terminal.
// The owner asked for exactly this on 2026-10-09 — "switch to Loki so I can
// develop it there with either chat or terminal interface" — and got the same
// advice a third time. Pinned here: the hand-off keeps what they said last
// when it has to cut, never exceeds the address-bar budget, lands on the
// right Loki surface, and the widget never sends the pass or the project
// name anywhere but through Loki's own signed-in route.
// Run: npx tsx scripts/test/widget-continue.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { continueUrl, HANDOFF_MAX, handoffText } from "../../widget/continue";
import type { ThreadItem } from "../../widget/thread";
import { CONTINUE_TEXT_MAX, CONTINUE_VIEWS, continueHref } from "@/lib/widget/continue";

const page = {
  title: "Im Treppehuus — Wo Sie s bruuched · Heidi",
  url: "https://heidi.orangecat.ch/gsw/situations/neighbours",
};

// ---- the thread as one message ----
{
  const thread: ThreadItem[] = [
    { kind: "you", at: 1, text: "I want you to add a situation for the word Bünzli." },
    { kind: "loki", at: 2, text: "Here is what I'd build.", changes: ["Add a Bünzli scene"] },
    { kind: "sent", at: 3, text: "Add a Bünzli scene", owner: true, building: true },
    { kind: "noticed", at: 4, text: "This page took 3.6s to load.", fix: "Make it faster" },
  ];
  const text = handoffText(thread, page);
  assert.ok(text.startsWith(`From Loki on “${page.title}” (${page.url}):`), "the page leads");
  assert.ok(
    text.includes("Me: I want you to add a situation for the word Bünzli."),
    "their words, in full",
  );
  assert.ok(text.includes("Loki: Here is what I'd build."));
  assert.ok(
    text.includes("Sent to the builder: Add a Bünzli scene"),
    "receipts travel as one line",
  );
  assert.ok(text.includes("Loki noticed: This page took 3.6s to load."));
  assert.ok(text.length <= HANDOFF_MAX);
}
{
  // Over budget: the oldest turns go first, the newest stay whole.
  const thread: ThreadItem[] = Array.from({ length: 30 }, (_, i) => ({
    kind: "you" as const,
    at: i,
    text: `turn ${i} ${"x".repeat(120)}`,
  }));
  const text = handoffText(thread, page);
  assert.ok(text.length <= HANDOFF_MAX, "never over the address-bar budget");
  assert.ok(text.includes("turn 29 "), "what they said last is kept");
  assert.ok(!text.includes("Me: turn 0 "), "the oldest is dropped first");
}
{
  // Loki's answers are clipped; the person's own words are not.
  const long = "a".repeat(1000);
  const text = handoffText([{ kind: "loki", at: 1, text: long }], page);
  assert.ok(text.length < 450, "an answer is clipped to a line");
  assert.ok(text.endsWith("…"));
  const mine = handoffText([{ kind: "you", at: 1, text: long }], page);
  assert.ok(mine.includes(long), "the owner's own words are never cut");
}
{
  const empty = handoffText([], { title: "  ", url: "https://x.test/p" });
  assert.equal(
    empty,
    "From Loki on “https://x.test/p” (https://x.test/p):",
    "no title: the url stands in",
  );
}

// ---- the link out ----
{
  const u = new URL(
    continueUrl({
      apiBase: "https://loki.orangecat.ch",
      token: "fcw_abc",
      view: "chat",
      text: "Me: hello",
      here: "https://heidi.orangecat.ch/gsw/situations/neighbours#loki",
    }),
  );
  assert.equal(u.origin + u.pathname, "https://loki.orangecat.ch/api/widget/continue");
  assert.equal(u.searchParams.get("token"), "fcw_abc");
  assert.equal(u.searchParams.get("view"), "chat");
  assert.equal(u.searchParams.get("q"), "Me: hello");
  assert.equal(
    u.searchParams.get("return"),
    "https://heidi.orangecat.ch/gsw/situations/neighbours",
    "the fragment never travels",
  );
  const term = new URL(
    continueUrl({
      apiBase: "https://loki.orangecat.ch",
      token: "fcw_abc",
      view: "terminal",
      text: "Me: hi",
      here: "https://h.test/",
    }),
  );
  assert.equal(term.searchParams.get("view"), "terminal");
  assert.equal(
    term.searchParams.get("q"),
    "Me: hi",
    "the terminal's rail composer takes the thread too",
  );
}

// ---- where it lands, inside Loki ----
assert.deepEqual([...CONTINUE_VIEWS], ["chat", "terminal"]);
assert.ok(CONTINUE_TEXT_MAX >= HANDOFF_MAX, "the route accepts what the widget sends");
assert.equal(continueHref("Heidi", "chat", "Me: hello"), "/loki?project=Heidi&q=Me%3A%20hello");
assert.equal(continueHref("Heidi", "chat", "  "), "/loki?project=Heidi", "nothing to prefill");
assert.equal(
  continueHref("Heidi", "terminal", "Me: hello"),
  "/terminal?project=Heidi&view=terminal&q=Me%3A%20hello",
);
const termPage = readFileSync("src/components/terminal/TerminalPageClient.tsx", "utf8");
assert.match(termPage, /searchParams\.get\("q"\)/, "/terminal reads ?q= into the rail's composer");
const rail = readFileSync("src/components/terminal/TerminalLokiRail.tsx", "utf8");
assert.match(
  rail,
  /initialDraft \? \{ text: initialDraft, nonce: 1 \} : null/,
  "as a draft, unsent",
);
assert.equal(continueHref("my project", "chat", null), "/loki?project=my%20project");

// ---- the route is reachable: it signs the person in itself ----
// Observed live on 2026-10-09: the merged route answered a bare 401 because
// the session middleware caught it first, so "Continue in Loki" was a wall.
const proxy = readFileSync("src/proxy.ts", "utf8");
assert.match(
  proxy,
  /\|api\/widget\/continue\|/,
  "the route is on the public list and guards itself",
);
assert.match(
  proxy,
  /\|api\/widget\/owner\|/,
  "so is /api/widget/owner, which covers owner/changes",
);

// ---- the route is the only place the project is resolved ----
const route = readFileSync("src/app/api/widget/continue/route.ts", "utf8");
assert.match(route, /getApiUserId\(\)/, "signed in with Loki, or sent to sign in");
assert.match(route, /callbackUrl/, "and brought back afterwards");
assert.match(
  route,
  /getProjectAccess\(userId, token\.projectId\)/,
  "only someone who may work on the project",
);
assert.match(route, /ownerReturnUrl\(/, "a stranger goes back to the site they came from");
assert.match(route, /OWNER_DENIED_HASH/, "— with a word about why");
assert.match(route, /getWidgetProjectKey\(/, "the token becomes a project here, not in the widget");
assert.match(route, /continueHref\(key, view, text\)/);

// ---- the widget side ----
const row = readFileSync("widget/continue-row.ts", "utf8");
assert.match(row, /"Continue in Loki"/, "the row exists");
assert.match(row, /"Chat →"/);
assert.match(row, /"Terminal →"/);
assert.match(
  row,
  /This is my site — continue in Loki →/,
  "a visitor has one door, which signs them in",
);
const greeting = readFileSync("widget/greeting.ts", "utf8");
assert.match(
  greeting,
  /This is my site — sign in with Loki →/,
  "the owner's door is under the greeting",
);
const convo = readFileSync("widget/conversation.ts", "utf8");
assert.match(convo, /createContinueRow\(/, "and the conversation renders the row");
assert.match(convo, /ownerDoor\(/, "and the door");
assert.match(
  convo,
  /ownerPass: opts\.ownerPass\(\) \?\? undefined/,
  "the owner is the owner to the advisor too",
);
const api = readFileSync("widget/loki-api.ts", "utf8");
assert.match(api, /ownerPass: opts\.ownerPass/, "the pass travels with the question");
const advise = readFileSync("src/app/api/widget/advise/route.ts", "utf8");
assert.match(advise, /ownerPass: z\.string\(\)/, "and the route accepts it");
assert.match(advise, /verifyOwnerPass\(data\.ownerPass\)/, "verified, never trusted");
assert.match(
  advise,
  /pass\.projectId === token\.projectId && pass\.userId === token\.userId/,
  "for this project and this owner",
);

// ---- the phone ----
const theme = readFileSync("widget/theme.ts", "utf8");
assert.match(
  theme,
  /\.hdr > div:first-child \{ min-width: 0; flex: 1 1 auto; \}/,
  "the header's text column shrinks before ✕ leaves the screen",
);
assert.match(theme, /\.watchbtn \{[^\n]*white-space: nowrap/, "Stop watching stays one line");
const main = readFileSync("widget/main.ts", "utf8");
assert.match(
  main,
  /hideLink\.style\.display = ownerPass \? "none" : ""/,
  "the owner is not offered to hide their own tool",
);

console.log("widget-continue: ok");
