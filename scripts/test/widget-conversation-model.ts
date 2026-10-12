// The widget conversation's rules with no DOM (widget/conversation-model.ts) —
// what every view of the panel relies on, the vanilla one today and the shared
// chat next: asking, failing without losing the question, the visitor's
// confirmation card, the owner's straight-to-build, and which changes move
// the reader to the newest message.
//
// Run: npx tsx scripts/test/widget-conversation-model.ts
import { REVIEW_QUESTION } from "../../widget/loki-api";
import {
  createConversationModel,
  startersFor,
  type ConversationModelOpts,
} from "../../widget/conversation-model";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// The few browser globals the calls read.
const store = new Map<string, string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
  location: { href: "https://farm.example/rooms", pathname: "/rooms" },
  document: { title: "Farmhouse" },
  window: { innerWidth: 390, innerHeight: 844 },
});

type Reply = { status: number; body: unknown };
let replies: Reply[] = [];
const posted: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (url: string, init?: { body?: string }) => {
  posted.push({ url, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
  const r = replies.shift() ?? { status: 500, body: {} };
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as typeof fetch;

function model(over: Partial<ConversationModelOpts> = {}) {
  store.clear();
  const follows: boolean[] = [];
  let cleared = 0;
  const m = createConversationModel({
    apiBase: "https://loki.test",
    token: "fcw_t",
    assistant: () => "concierge",
    ownerPass: () => null,
    onPassRefused: () => {},
    picker: {
      isPicking: () => false,
      start: () => {},
      stop: () => {},
      clearSelection: () => {},
      selected: () => [],
    },
    watch: () => null,
    about: () => "page",
    scope: () => "page",
    screenshots: { list: () => ["data:image/png;base64,AA"], clear: () => void cleared++ },
    ...over,
  });
  m.subscribe((f) => follows.push(f));
  return { m, follows, cleared: () => cleared };
}

async function main() {
  // Starters: an empty conversation offers them; Review leads while watching
  // and is the only one left once the conversation has started.
  ok(
    startersFor("concierge", [], false).list.length === 3,
    "an empty conversation offers starters",
  );
  ok(startersFor("none", [], false).list.length === 0, "no AI, no starters");
  const said = [{ kind: "you" as const, at: 1, text: "hi" }];
  ok(startersFor("advisor", said, false).list.length === 0, "starters go once you have spoken");
  const watching = startersFor("advisor", said, true).list;
  ok(watching.length === 1 && watching[0] === REVIEW_QUESTION, "while watching, Review stays");

  {
    // Asking: your words land at once and follow; the answer replaces pending.
    const { m, follows } = model();
    replies = [{ status: 200, body: { ok: true, reply: "We build sites.", messages: [] } }];
    const asked = m.ask("What can you build?");
    ok(m.snapshot().pending !== null, "asking shows Loki working");
    ok(m.snapshot().thread.at(-1)?.kind === "you", "…with your words already in the thread");
    await asked;
    await new Promise((r) => setTimeout(r, 0));
    const s = m.snapshot();
    ok(s.pending === null && s.error === "", "the answer clears pending");
    ok(s.thread.at(-1)?.kind === "loki", "…and Loki's reply is the newest message");
    ok(follows.every(Boolean), "your own question follows to the newest message");
    ok(posted.at(-1)?.url === "https://loki.test/api/widget/chat", "the concierge is asked");
  }
  {
    // A failure says why and keeps the question — one tap from the builder.
    const { m } = model();
    replies = [{ status: 503, body: { error: "Loki is busy — try again." } }];
    m.ask("Hello?");
    await new Promise((r) => setTimeout(r, 10));
    const s = m.snapshot();
    ok(s.error.length > 0, `a failed ask says so (${s.error})`);
    ok(s.thread.at(-1)?.kind === "you", "…and the question stays in the thread");
    ok(s.pending === null, "…and Loki is no longer shown working");
  }
  {
    // A visitor's "send to builder" opens the confirmation card; it sends as edited.
    const { m, cleared } = model();
    m.build("The phone number is wrong");
    ok(
      m.snapshot().draft?.text === "The phone number is wrong",
      "a visitor gets the confirmation card",
    );
    replies = [{ status: 200, body: { ok: true, claimUrl: "https://loki.test/claim/x" } }];
    await m.sendDraft("The phone number on Contact is wrong", "ann@example.com");
    const s = m.snapshot();
    const sent = posted.at(-1);
    ok(sent?.url === "https://loki.test/api/feedback", "the card files a report");
    ok(sent?.body.contact === "ann@example.com", "…with who sent it");
    ok(String(sent?.body.suggestion).includes("on Contact"), "…as edited, not as first typed");
    ok(s.draft === null && s.thread.at(-1)?.kind === "sent", "the receipt replaces the card");
    ok(cleared() === 1, "the screenshots went with it and the tray is cleared");
  }
  {
    // The owner's word is the decision: no card, it starts building.
    const { m } = model({ ownerPass: () => "pass" });
    replies = [{ status: 200, body: { ok: true, owner: true, building: true } }];
    m.build("Make the button say Book");
    await new Promise((r) => setTimeout(r, 10));
    const s = m.snapshot();
    ok(s.draft === null, "the owner skips the confirmation card");
    const last = s.thread.at(-1);
    ok(last?.kind === "sent" && last.owner === true, "…and the receipt says it is building");
  }
  {
    // About Loki itself: straight to Loki's own project, no card.
    const { m } = model({ about: () => "loki" });
    replies = [{ status: 200, body: { ok: true } }];
    m.build("The panel covers the menu");
    await new Promise((r) => setTimeout(r, 10));
    ok(
      posted.at(-1)?.url === "https://loki.test/api/widget/self-report",
      "about Loki goes to Loki",
    );
    ok(m.snapshot().draft === null, "…without a confirmation card");
  }
  {
    // Remarks Loki makes unasked never move your reading place; its answers do.
    const { m, follows } = model();
    m.noticed({ say: "The menu button has no label.", fix: "Label it" });
    m.selfNote("Checked the panel.");
    m.say("This site is not yours.");
    ok(follows.join() === "false,false,true", `quiet remarks keep your place (${follows.join()})`);
  }
  {
    // The thread survives a page load (sessionStorage), validated on restore.
    const { m } = model();
    m.say("Kept across pages.");
    const again = createConversationModel({
      apiBase: "https://loki.test",
      token: "fcw_t",
      assistant: () => "concierge",
      ownerPass: () => null,
      onPassRefused: () => {},
      picker: {
        isPicking: () => false,
        start() {},
        stop() {},
        clearSelection() {},
        selected: () => [],
      },
      watch: () => null,
      about: () => "page",
      scope: () => "page",
      screenshots: { list: () => [], clear() {} },
    });
    ok(
      again.snapshot().thread.some((i) => i.kind === "loki" && i.text === "Kept across pages."),
      "the thread is restored on the next page",
    );
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
