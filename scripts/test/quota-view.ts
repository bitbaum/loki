/**
 * The quota surface, and the rule it enforces: a number without an action is
 * decoration.
 *
 * The load-bearing cases are the ones about ABSENCE. A provider nobody has
 * called has no reading, and drawing that as a full tank is the same mistake as
 * trusting a vendor's own usage endpoint — which was measured reporting an
 * untouched allowance while the key was locked out of free models.
 *
 * Run: npx tsx scripts/test/quota-view.ts
 */
import assert from "node:assert/strict";
import {
  bindingRows,
  dedupeConsequences,
  describeQuota,
  unknownQuota,
  summarise,
  refillsIn,
  TOKENS_PER_ANSWER,
} from "@/lib/ai/quota-view";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const row = (over: Partial<Parameters<typeof describeQuota>[0]> = {}) => ({
  provider: "groq",
  model: "openai/gpt-oss-120b",
  scope: "requests",
  window: "day",
  quotaLimit: 1000,
  remaining: 900,
  resetAt: new Date(Date.UTC(2026, 8, 13, 0, 0, 0)),
  observedAt: new Date(NOW - 30_000),
  ...over,
});

// ── Every row carries its consequence ───────────────────────────────────────
check("a healthy counter says what is left AND what happens after", () => {
  const v = describeQuota(row(), { now: NOW, nextProvider: "openrouter" });
  assert.equal(v.state, "known");
  assert.equal(v.answers, 900);
  assert.match(v.detail, /900 of 1,000 requests today/);
  assert.equal(v.refills, "in 12 hours");
  assert.match(v.consequence, /moves to openrouter/);
});

check("the last link in the chain does not imply a safety net it does not have", () => {
  const v = describeQuota(row(), { now: NOW, nextProvider: null });
  assert.match(v.consequence, /last link/);
  assert.doesNotMatch(v.consequence, /moves to/);
});

// ── Tokens become answers ───────────────────────────────────────────────────
check("a token counter is translated into answers, the unit a person thinks in", () => {
  const v = describeQuota(
    row({ scope: "tokens", window: "minute", quotaLimit: 8000, remaining: 7927 }),
    { now: NOW, nextProvider: "openrouter" },
  );
  assert.equal(v.answers, Math.floor(7927 / TOKENS_PER_ANSWER));
  assert.match(v.detail, /7,927 of 8,000 tokens this minute/, v.detail);
});

// ── The three states ────────────────────────────────────────────────────────
check("zero remaining is EXHAUSTED, and it is urgent", () => {
  const v = describeQuota(row({ remaining: 0 }), { now: NOW, nextProvider: "openrouter" });
  assert.equal(v.state, "exhausted");
  assert.equal(v.urgent, true);
  assert.equal(v.refills, "in 12 hours", "and it still says when it comes back");
});

check("a provider never called is UNKNOWN, with the reason stated", () => {
  const v = unknownQuota("cloudflare", "no answer served yet today");
  assert.equal(v.state, "unknown");
  assert.equal(v.answers, null, "null, not 0 — absence is not emptiness");
  assert.equal(v.level, null, "and there is nothing to draw a gauge against");
  assert.equal(v.urgent, false);
});

check("a stale per-MINUTE reading reverts to unknown rather than lying", () => {
  // A minute counter read six minutes ago says nothing about now. Reporting it
  // as current is how a dashboard becomes confidently wrong.
  const v = describeQuota(
    row({ scope: "tokens", window: "minute", observedAt: new Date(NOW - 6 * 60_000) }),
    { now: NOW, nextProvider: null },
  );
  assert.equal(v.state, "unknown");
  assert.equal(v.answers, null);
  assert.match(v.detail, /not measured recently/);
});

check("a DAY reading from hours ago is still good — it does not refill until reset", () => {
  const v = describeQuota(row({ observedAt: new Date(NOW - 6 * 60 * 60_000) }), {
    now: NOW,
    nextProvider: null,
  });
  assert.equal(v.state, "known", "staleness is per-window, not a single timeout");
});

// ── Attention budget ────────────────────────────────────────────────────────
check("a nearly-full counter is not urgent; a nearly-empty one is", () => {
  assert.equal(
    describeQuota(row({ remaining: 900 }), { now: NOW, nextProvider: null }).urgent,
    false,
  );
  assert.equal(
    describeQuota(row({ remaining: 50 }), { now: NOW, nextProvider: null }).urgent,
    true,
  );
});

check("no stated ceiling means no gauge, rather than a made-up one", () => {
  const v = describeQuota(row({ quotaLimit: null, remaining: 42 }), {
    now: NOW,
    nextProvider: null,
  });
  assert.equal(v.level, null);
  assert.match(v.detail, /42 requests left today/);
});

// ── Refill wording ──────────────────────────────────────────────────────────
check("refill times read as a person would say them", () => {
  assert.equal(refillsIn(new Date(NOW + 40_000), NOW), "in under a minute");
  assert.equal(refillsIn(new Date(NOW + 12 * 60_000), NOW), "in 12 minutes");
  assert.equal(refillsIn(new Date(NOW + 3 * 3600_000), NOW), "in 3 hours");
  assert.equal(refillsIn(new Date(NOW - 5_000), NOW), "now");
  assert.equal(refillsIn(null, NOW), null, "a vendor that did not say gets no invented time");
});

// ── The headline ────────────────────────────────────────────────────────────
check("the summary leads with the total when things are healthy", () => {
  const rows = [
    describeQuota(row(), { now: NOW, nextProvider: "openrouter" }),
    describeQuota(row({ provider: "openrouter", remaining: 40, quotaLimit: 50 }), {
      now: NOW,
      nextProvider: null,
    }),
  ];
  assert.match(summarise(rows), /About 940 more answers/);
  assert.match(summarise(rows), /of 2 configured/, "always counted out of the total");
});

check("all-unknown says so, instead of implying health nobody checked", () => {
  const s = summarise([unknownQuota("groq", "x"), unknownQuota("openrouter", "y")]);
  assert.match(s, /2 not measured yet/);
  assert.match(s, /of 2 configured/);
});

check("everything spent is the headline, with the time it returns", () => {
  const s = summarise([describeQuota(row({ remaining: 0 }), { now: NOW, nextProvider: null })]);
  assert.match(s, /1 spent/);
  assert.match(s, /in 12 hours/);
  assert.match(s, /of 1 configured/, "never says 'every' when it means 'the one'");
});

check("a partial outage names both halves rather than averaging them away", () => {
  const s = summarise([
    describeQuota(row(), { now: NOW, nextProvider: null }),
    describeQuota(row({ provider: "openrouter", remaining: 0 }), { now: NOW, nextProvider: null }),
    unknownQuota("cloudflare", "not called yet"),
  ]);
  assert.match(s, /900 more answers/);
  assert.match(s, /1 spent/);
  assert.match(s, /1 not measured yet/);
  assert.match(s, /of 3 configured/);
});

check("no providers at all is stated plainly, not as zero remaining", () => {
  assert.match(summarise([]), /No AI providers are configured/);
});

// ── A skip is not an outage ─────────────────────────────────────────────────
// The page shipped telling the operator Groq was "configured, but it has not
// served an answer yet — will be measured on the next answer it serves". Both
// halves were false: it HAD served (through an unmetered fallback), and it was
// being walked past on every turn because the prompt exceeded its budget. It
// would never be measured, and the operator was told to wait for that.

const skipRow = (over = {}) => ({
  provider: "groq",
  model: "openai/gpt-oss-120b",
  scope: "requests",
  window: "unknown",
  quotaLimit: null,
  remaining: 0,
  resetAt: null,
  observedAt: new Date(NOW - 30_000),
  source: "preflight",
  note: "skipped without being called: a ~10,153-token prompt exceeds this model's 5,400-token budget",
  ...over,
});

check("a SKIPPED provider is not reported as spent — opposite problem, opposite fix", () => {
  const v = describeQuota(skipRow(), { now: NOW, nextProvider: "openrouter" });
  assert.equal(v.state, "skipped", "remaining is 0 only to satisfy a non-null column");
  assert.notEqual(v.state, "exhausted", "this vendor has capacity and is never reached");
  assert.match(v.detail, /10,153-token prompt exceeds/, v.detail);
});

check("its consequence names the fix, because waiting changes nothing", () => {
  const v = describeQuota(skipRow(), { now: NOW, nextProvider: "openrouter" });
  assert.match(v.consequence, /shorten the prompt|raise its budget/, v.consequence);
  assert.doesNotMatch(v.consequence, /moves to openrouter/, "it never gets that far");
  assert.equal(v.refills, null, "nothing refills — it was never drawn from");
});

check("a silently-unused provider is URGENT: paid-for capacity never spent", () => {
  assert.equal(describeQuota(skipRow(), { now: NOW, nextProvider: null }).urgent, true);
});

check("the summary names a skip separately from a spend", () => {
  const s = summarise([
    describeQuota(row({ provider: "openrouter", remaining: 0, quotaLimit: 50 }), {
      now: NOW,
      nextProvider: null,
    }),
    describeQuota(skipRow(), { now: NOW, nextProvider: null }),
  ]);
  assert.match(s, /1 spent/);
  assert.match(s, /1 never reached/, s);
  assert.match(s, /of 2 configured/);
});

// ── One model, one row: the counter that actually stops you ─────────────────
// The exact shape observed on production 2026-09-13: two healthy Groq counters
// and a third, visible only in a refusal, that was the reason every question
// returned a 503.
const groqThree = () => [
  describeQuota(row({ scope: "tokens", window: "minute", quotaLimit: 8000, remaining: 2672 }), {
    now: NOW,
    nextProvider: "openrouter",
  }),
  describeQuota(row({ scope: "requests", window: "day", quotaLimit: 1000, remaining: 999 }), {
    now: NOW,
    nextProvider: "openrouter",
  }),
  describeQuota(row({ scope: "tokens", window: "day", quotaLimit: 200_000, remaining: 227 }), {
    now: NOW,
    nextProvider: "openrouter",
  }),
];

check("the BLOCKING counter leads, not the healthy one measured most recently", () => {
  const [only, ...extra] = bindingRows(groqThree());
  assert.equal(extra.length, 0, "three counters for one model must render as one row");
  assert.equal(only!.state, "exhausted", "227 of 200,000 tokens is spent, whatever the others say");
  assert.match(only!.detail, /today/, only!.detail);
});

check("the counters that did NOT win are still named, so nothing measured is hidden", () => {
  const [only] = bindingRows(groqThree());
  assert.equal(only!.alsoMetered?.length, 2);
  assert.ok(
    only!.alsoMetered?.some((d) => /this minute/.test(d)),
    "the per-minute window is still reported, just not drawn",
  );
});

check("the summary counts PROVIDERS, not counters", () => {
  // Three rows for one model made a page with two vendors announce five.
  const s = summarise([...bindingRows(groqThree()), unknownQuota("openrouter", "not called yet")]);
  assert.match(s, /of 2 configured/, s);
});

check("among healthy counters the tightest one leads", () => {
  const rows = bindingRows([
    describeQuota(row({ scope: "requests", window: "day", quotaLimit: 1000, remaining: 990 }), {
      now: NOW,
      nextProvider: null,
    }),
    describeQuota(row({ scope: "tokens", window: "day", quotaLimit: 200_000, remaining: 40_000 }), {
      now: NOW,
      nextProvider: null,
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.detail, /tokens/, "20% left beats 99% left");
});

check("a model with one counter is unchanged, and carries no 'also' line", () => {
  const [v] = bindingRows([describeQuota(row(), { now: NOW, nextProvider: "openrouter" })]);
  assert.equal(v!.alsoMetered, undefined);
  assert.equal(v!.state, "known");
});

check("a skip is superseded by a LATER reading — the fix must show as fixed", () => {
  // The exact regression the budget fix would otherwise cause: the vendor
  // starts answering, and the page keeps insisting it is never reached because
  // a skip row is only ever replaced by another skip.
  const rows = bindingRows([
    describeQuota(
      { ...skipRow(), observedAt: new Date(NOW - 3_600_000) },
      { now: NOW, nextProvider: "openrouter" },
    ),
    describeQuota(
      row({ scope: "tokens", window: "day", quotaLimit: 200_000, remaining: 150_000 }),
      { now: NOW, nextProvider: "openrouter" },
    ),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.state, "known", "an hour-old skip cannot outrank a reading from 30s ago");
});

check("a skip NEWER than every reading still leads — it is the current fact", () => {
  const rows = bindingRows([
    describeQuota(skipRow(), { now: NOW, nextProvider: "openrouter" }),
    describeQuota(
      {
        ...row({ scope: "tokens", window: "day", quotaLimit: 200_000, remaining: 150_000 }),
        observedAt: new Date(NOW - 3_600_000),
      },
      { now: NOW, nextProvider: "openrouter" },
    ),
  ]);
  assert.equal(rows[0]!.state, "skipped", "the most recent thing that happened was a walk-past");
});

// ── "Spent" must never sit beside a number that says otherwise ──────────────
// Rendered from the live table and caught by eye: a per-minute window holding
// 3,984 of 8,000 tokens was labelled SPENT, because 3,984 buys no whole answer.
// The state is right — the turn cannot be served — but the word contradicts the
// figure printed next to it, which is how a page gets called made-up.
const lowMinute = () =>
  describeQuota(row({ scope: "tokens", window: "minute", quotaLimit: 8000, remaining: 3984 }), {
    now: NOW,
    nextProvider: "openrouter",
  });

check("a window holding half a tank is not called spent", () => {
  const v = lowMinute();
  assert.equal(v.shortfall, true);
  assert.match(v.detail, /3,984 of 8,000/, "the figure is still shown in full");
  assert.match(v.detail, /under one answer's worth/, "and it is explained, not contradicted");
});

check("an actually-empty counter is NOT a shortfall", () => {
  const v = describeQuota(
    row({ scope: "tokens", window: "minute", quotaLimit: 8000, remaining: 0 }),
    {
      now: NOW,
      nextProvider: "openrouter",
    },
  );
  assert.equal(v.shortfall, undefined, "zero left is spent, and must keep saying so");
  assert.equal(v.state, "exhausted");
});

check("the summary counts 'too low' apart from 'spent'", () => {
  const s = summarise([
    lowMinute(),
    describeQuota(
      row({ provider: "openrouter", scope: "requests", remaining: 0, quotaLimit: 50 }),
      {
        now: NOW,
        nextProvider: null,
      },
    ),
  ]);
  assert.match(s, /1 spent/, s);
  assert.match(s, /1 too low for another answer/, s);
});

check("the 'also metered' line carries measurements only", () => {
  // A skip notice is not a counter, and a stale counter does not even name
  // which counter it is — neither belongs in a list of what was measured.
  const [only] = bindingRows([
    describeQuota(row({ scope: "tokens", window: "day", quotaLimit: 200_000, remaining: 227 }), {
      now: NOW,
      nextProvider: "openrouter",
    }),
    describeQuota(row({ scope: "requests", window: "day", quotaLimit: 1000, remaining: 997 }), {
      now: NOW,
      nextProvider: "openrouter",
    }),
    describeQuota(skipRow(), { now: NOW, nextProvider: "openrouter" }),
    // Stale: a per-minute counter read an hour ago.
    describeQuota(
      {
        ...row({ scope: "tokens", window: "minute", quotaLimit: 8000, remaining: 5000 }),
        observedAt: new Date(NOW - 3_600_000),
      },
      { now: NOW, nextProvider: "openrouter" },
    ),
  ]);
  assert.equal(only!.alsoMetered?.length, 1, only!.alsoMetered?.join(" | "));
  assert.match(only!.alsoMetered![0]!, /997 of 1,000/);
});

check("two different models stay two rows", () => {
  const rows = bindingRows([
    describeQuota(row({ model: "a" }), { now: NOW, nextProvider: null }),
    describeQuota(row({ model: "b" }), { now: NOW, nextProvider: null }),
  ]);
  assert.equal(rows.length, 2, "grouping is per MODEL — Groq meters each one separately");
});

// ── A vendor that publishes nothing has still SERVED ────────────────────────
// Seen on the live page 2026-09-17: the google row read "configured, but it has
// not served an answer yet" while Gemini was answering most of the traffic. It
// has no rate-limit headers, so it can never appear in provider_quota — the row
// would have stayed false forever, whoever waited. Spend is the second witness.

check("a vendor that served but discloses no limits does not read as never called", () => {
  const v = unknownQuota(
    "google",
    "served 14 calls today (9,532 tokens) — this vendor publishes no limits, so there is nothing left to measure",
    "working, but its headroom cannot be known until it refuses",
  );
  assert.equal(v.state, "unknown", "still unknown — nothing was MEASURED");
  assert.match(v.detail, /served 14 calls today/, v.detail);
  assert.doesNotMatch(v.detail, /has not served/, "the false claim must be gone");
  assert.doesNotMatch(
    v.consequence,
    /will be measured/,
    "promising a future measurement is the same lie one step later",
  );
});

check("a vendor nobody has called still says exactly that", () => {
  const v = unknownQuota("cloudflare", "configured, but it has not served an answer yet");
  assert.match(v.detail, /has not served an answer yet/);
  assert.match(v.consequence, /will be measured/, "here the promise IS true");
});

// ── The unit has to match what the counter counts ───────────────────────────
check("a transcription model's counter is not labelled in answers", () => {
  const v = describeQuota(
    row({ model: "whisper-large-v3-turbo", remaining: 1999, quotaLimit: 2000 }),
    {
      now: NOW,
      nextProvider: null,
    },
  );
  assert.equal(v.unitNoun, "transcriptions", "whisper serves transcriptions, not answers");
});

check("a chat model keeps answers", () => {
  const v = describeQuota(row(), { now: NOW, nextProvider: null });
  assert.equal(v.unitNoun, "answers");
});

// ── Say it once ─────────────────────────────────────────────────────────────
check("a consequence repeated under itself is blanked, not printed five times", () => {
  const last = "this is the last link — after it, answers wait for the reset";
  const rows = dedupeConsequences([
    { ...unknownQuota("a", "x"), consequence: last },
    { ...unknownQuota("b", "x"), consequence: last },
    { ...unknownQuota("c", "x"), consequence: last },
  ]);
  assert.equal(rows[0]!.consequence, last, "the first still says it");
  assert.equal(rows[1]!.consequence, "");
  assert.equal(rows[2]!.consequence, "");
});

check("a consequence that returns after a different one speaks again", () => {
  const rows = dedupeConsequences([
    { ...unknownQuota("a", "x"), consequence: "moves to google" },
    { ...unknownQuota("b", "x"), consequence: "last link" },
    { ...unknownQuota("c", "x"), consequence: "moves to google" },
  ]);
  assert.equal(rows[2]!.consequence, "moves to google", "not a global dedupe — only the row above");
});

console.log(`✓ quota view: ${passed} checks passed`);
