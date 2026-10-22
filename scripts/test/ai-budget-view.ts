/**
 * Inline tests for the person's budget view (lib/ai/budget-view.ts).
 *
 * The property under test is not the arithmetic — fair-share.ts already pins
 * that — it is that the screen never says something the gate would contradict:
 *
 *   - "N answers now" is zero exactly when the gate would refuse the next turn,
 *     whatever the person's cheap real turns suggest;
 *   - paced, spent and pool-spent are three different sentences, because they
 *     have three different remedies (wait · wait for midnight · nothing today);
 *   - a vendor nobody heard from today is NOT the pool being spent;
 *   - the per-answer cost becomes the person's own measurement once they have
 *     a few turns, and stays the constant before that.
 *
 * Numbers are chosen to be checkable by hand: a 100_000-token day, one user,
 * at noon UTC — so the share is 100k and the paced allowance is 75k.
 *
 * Run: npx tsx scripts/test/ai-budget-view.ts
 */
import { nextUtcMidnight } from "@bitbaum/ai-kit";
import { headroomNote, userBudgetView, type BudgetInput } from "@/lib/ai/budget-view";
import { ESTIMATED_TURN_TOKENS, turnReserveTokens } from "@/lib/ai-budget/gate";
import {
  describeQuota,
  TOKENS_PER_ANSWER,
  type QuotaReadingRow,
  type QuotaRowView,
} from "@/lib/ai/quota-view";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const NOON = new Date("2026-08-15T12:00:00Z");
const CHAIN = [
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "openrouter", model: "qwen/qwen3-32b:free" },
];

function input(over: Partial<BudgetInput> = {}): BudgetInput {
  return {
    now: NOON,
    dayCapacityTokens: 100_000,
    activeUsers: 1,
    userSpentTokens: 0,
    userTurns: 0,
    chain: CHAIN,
    vendorRows: [],
    ownKeys: [],
    memory: { turns: 8, charsPerTurn: 600 },
    ...over,
  };
}

function row(over: Partial<QuotaRowView>): QuotaRowView {
  return {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    state: "known",
    answers: 40,
    detail: "240,000 of 300,000 tokens today",
    refills: "in 12 hours",
    consequence: "",
    level: 0.8,
    urgent: false,
    ...over,
  };
}

console.log("ai-budget-view");

check("a fresh day: answers now and today, counted at the constant, bar at zero", () => {
  const v = userBudgetView(input());
  const p = v.freePool;
  assert(p.state === "ok", `state ${p.state}`);
  assert(p.shareTokens === 100_000, `share ${p.shareTokens}`);
  assert(p.allowanceTokens === 75_000, `allowance ${p.allowanceTokens}`);
  assert(!p.measured && p.tokensPerAnswer === TOKENS_PER_ANSWER, "constant before any turn");
  // One admission while the 20k estimate fits, then one per real answer above it.
  const admissions = (left: number) =>
    1 + Math.floor((left - ESTIMATED_TURN_TOKENS) / TOKENS_PER_ANSWER);
  assert(p.answersNow === admissions(75_000), `now ${p.answersNow}`);
  assert(p.answersToday === admissions(100_000), `today ${p.answersToday}`);
  assert(p.usedLevel === 0, "nothing used");
  assert(p.answersToday > p.answersNow && /free up through the day/.test(p.line), p.line);
  // A clock time in the person's zone, not a countdown: noon UTC in August is
  // 14:00 in Zurich, and midnight UTC is 02:00 there tomorrow.
  assert(/full again tomorrow at 02:00/.test(p.line), p.line);
  assert(p.line.startsWith(`${p.answersToday} free answers left today`), p.line);
  assert(p.short === `${p.answersToday} left`, `${p.short}`);
  assert(v.headline === p.line, v.headline);
  assert(!/share|pool|unlock|pac/i.test(p.line), `no jargon: ${p.line}`);
  assert(v.resetsAt === "2026-08-16T00:00:00.000Z", v.resetsAt);
});

check("the per-answer cost is the person's own mean once they have a few turns", () => {
  const p = userBudgetView(input({ userSpentTokens: 30_000, userTurns: 3 })).freePool;
  assert(p.measured && p.tokensPerAnswer === 10_000, `${p.tokensPerAnswer} measured=${p.measured}`);
  // Mean 10k → the gate reserves 12.5k (mean + 25%). 75k allowance − 30k
  // spent = 45k now: one admission at the reserve, then three at 10k.
  // Today: 70k left → 1 + 5.
  assert(turnReserveTokens(30_000, 3) === 12_500, `${turnReserveTokens(30_000, 3)}`);
  assert(p.answersNow === 4, `now ${p.answersNow}`);
  assert(p.answersToday === 6, `today ${p.answersToday}`);
  assert(Math.abs(p.usedLevel - 0.3) < 1e-9, `level ${p.usedLevel}`);
  const one = userBudgetView(input({ userSpentTokens: 30_000, userTurns: 1 })).freePool;
  assert(!one.measured, "one turn is a sample, not a mean");
});

check(
  "the gate reserves the person's own cost, so cheap answers are not refused while room is left",
  () => {
    // 75k allowance, 60k spent over 30 turns (2k each): 15k left. The old flat
    // 20k reserve refused here and the screen said 0; the reserve is now 5k
    // (the floor), so this is admitted — and the screen and gate agree.
    assert(turnReserveTokens(60_000, 30) === 5_000, `${turnReserveTokens(60_000, 30)}`);
    const p = userBudgetView(input({ userSpentTokens: 60_000, userTurns: 30 })).freePool;
    assert(p.tokensPerAnswer === 2_000, `${p.tokensPerAnswer}`);
    assert(
      p.state === "ok" && p.answersNow === 1 + Math.floor(10_000 / 2_000),
      `${p.state} now=${p.answersNow}`,
    );
    // Never more than the old reserve, and never below the floor.
    assert(turnReserveTokens(900_000, 30) === ESTIMATED_TURN_TOKENS, "capped at the estimate");
    assert(turnReserveTokens(0, 0) === ESTIMATED_TURN_TOKENS, "the estimate before any turn");
  },
);

check("'answers now' is zero exactly when the gate would refuse", () => {
  // 72k spent over 30 turns (2.4k each, reserve 5k): 3k left of the 75k
  // allowance is under the reserve → paced, and the screen says 0.
  const p = userBudgetView(input({ userSpentTokens: 72_000, userTurns: 30 })).freePool;
  assert(p.state === "paced" && p.answersNow === 0, `${p.state} now=${p.answersNow}`);
  // 28k left today: one at the 5k reserve, then 23k at 2.4k → 1 + 9.
  assert(p.answersToday === 10, `today ${p.answersToday}`);
  assert(typeof p.unlocksIn === "string" && /^in /.test(p.unlocksIn), `unlocks ${p.unlocksIn}`);
  assert(/^10 free answers left today — the next one at \d\d:\d\d\.$/.test(p.line), p.line);
  assert(p.nextAt !== null && /^at \d\d:\d\d$/.test(p.nextAt), `${p.nextAt}`);
  assert(p.short === `next ${p.nextAt!.slice(3)}`, `${p.short}`);
  // Right at the edge the next turn is admitted and counts as one.
  const edge = userBudgetView(input({ userSpentTokens: 70_000, userTurns: 30 })).freePool;
  assert(edge.state === "ok" && edge.answersNow >= 1, `${edge.state} now=${edge.answersNow}`);
});

check("spent is a different sentence from paced: waiting does not help", () => {
  const p = userBudgetView(input({ userSpentTokens: 95_000, userTurns: 10 })).freePool;
  assert(p.state === "spent", p.state);
  assert(p.answersNow === 0 && p.answersToday === 0, "nothing left today");
  assert(p.unlocksIn === null, "no 'unlocks in' on a spent share");
  assert(p.line === "No free answers left today — full again tomorrow at 02:00.", p.line);
  assert(p.short === "0 left", `${p.short}`);
  assert(/no daily limit/.test(p.consequence), p.consequence);
});

check("no free provider at all is said as such, not as an empty share", () => {
  const v = userBudgetView(input({ dayCapacityTokens: 0, chain: [] }));
  assert(v.freePool.state === "none", v.freePool.state);
  assert(v.headline === "No free models on this server.", v.headline);
});

check("the pool is spent only when EVERY model's vendor refused — unknown is not a refusal", () => {
  const spentGroq = row({ state: "exhausted", answers: 0, refills: "in 3 hours", urgent: true });
  const half = userBudgetView(input({ vendorRows: [spentGroq] })).freePool;
  assert(half.state === "ok", `one vendor spent, other unheard: ${half.state}`);
  const spentOr = row({
    provider: "openrouter",
    model: "qwen/qwen3-32b:free",
    state: "exhausted",
    answers: 0,
    refills: null,
    urgent: true,
  });
  const all = userBudgetView(input({ vendorRows: [spentGroq, spentOr] })).freePool;
  assert(all.state === "pool-spent", all.state);
  assert(/used up for everyone today/.test(all.line), all.line);
  assert(/back in 3 hours/.test(all.line), all.line);
  // A reading for a model outside the chain says nothing about the pool.
  const stray = row({ model: "whisper-large-v3", state: "exhausted", answers: 0, urgent: true });
  const strayModels = userBudgetView(input({ vendorRows: [stray] })).models;
  assert(
    strayModels.length === CHAIN.length && strayModels.every((m) => !m.id.includes("whisper")),
    "one row per free model; a stray reading adds none",
  );
});

check("per-model headroom speaks only when there is something to act on", () => {
  assert(headroomNote(row({})) === null, "a healthy counter is silent");
  assert(headroomNote(row({ state: "unknown", answers: null })) === null, "unknown is silent");
  const low = headroomNote(row({ answers: 3, urgent: true, refills: "in 40 minutes" }));
  assert(low === "Running low — about 3 answers left, refills in 40 minutes", `${low}`);
  const out = headroomNote(row({ state: "exhausted", answers: 0, refills: "in 3 hours" }));
  assert(out === "Out of free budget, back in 3 hours — Auto moves past it", `${out}`);
  const skip = headroomNote(row({ state: "skipped", answers: null }));
  assert(skip === "Last request was too large for this model", `${skip}`);
  const v = userBudgetView(input({ vendorRows: [row({ answers: 3, urgent: true })] }));
  assert(v.models[0]!.id === "groq/openai/gpt-oss-120b", "keyed as the picker keys it");
});

check("every free model says what is left on it — not only the one about to run out", () => {
  const fresh = userBudgetView(input());
  const today = fresh.freePool.answersToday;
  assert(fresh.models.length === CHAIN.length, "a row for every free model");
  assert(
    fresh.models.every((m) => m.left === `${today} left today`),
    fresh.models.map((m) => m.left).join(" | "),
  );
  const low = userBudgetView(
    input({ vendorRows: [row({ answers: 3, urgent: true, refills: "in 40 minutes" })] }),
  );
  assert(
    low.models[0]!.left === "Running low — about 3 left, more in 40 minutes",
    low.models[0]!.left,
  );
  const out = userBudgetView(
    input({
      vendorRows: [row({ state: "exhausted", answers: 0, refills: "in 3 hours", urgent: true })],
    }),
  );
  assert(out.models[0]!.left === "None left right now — back in 3 hours", out.models[0]!.left);
  assert(
    out.models[1]!.left === `${today} left today`,
    "the other model still has the day's count",
  );
  const spent = userBudgetView(input({ userSpentTokens: 95_000, userTurns: 10 }));
  assert(
    spent.models.every((m) => m.left === "None left today — full again tomorrow at 02:00"),
    spent.models.map((m) => m.left).join(" | "),
  );
  const paced = userBudgetView(input({ userSpentTokens: 72_000, userTurns: 30 }));
  assert(
    /^10 left today · next one at \d\d:\d\d$/.test(paced.models[0]!.left),
    paced.models[0]!.left,
  );
  const skipped = userBudgetView(
    input({ vendorRows: [row({ state: "skipped", answers: null, urgent: true })] }),
  );
  assert(
    skipped.models[0]!.left === `${today} left today · the last request was too large for it`,
    skipped.models[0]!.left,
  );
  const tokyo = userBudgetView(input({ timeZone: "Asia/Tokyo" }));
  assert(/full again tomorrow at 09:00/.test(tokyo.freePool.line), tokyo.freePool.line);
});

check("own keys: their own line, no Loki cap, and the pool becomes the fallback", () => {
  const v = userBudgetView(
    input({
      ownKeys: [
        {
          vendor: "anthropic",
          label: "Anthropic",
          model: "claude-sonnet-5",
          billingUrl: "https://console.anthropic.com/settings/billing",
          limit: "a spend limit",
          usage: { tokensToday: 3_200, callsToday: 4, tokens30d: 48_000, calls30d: 51 },
        },
        {
          vendor: "custom",
          label: "MacBook Ollama",
          model: "llama3",
          billingUrl: null,
          limit: null,
          usage: null,
        },
      ],
    }),
  );
  const [a, b] = v.ownKeys;
  assert(
    a!.line === "Today 3,200 tokens in 4 answers · 30 days 48,000 tokens in 51 answers.",
    a!.line,
  );
  assert(
    /No limit from Loki — Anthropic bills you directly — set a spend limit there/.test(
      a!.consequence,
    ),
    a!.consequence,
  );
  assert(b!.line === "Nothing spent on it yet." && !/set a/.test(b!.consequence), b!.consequence);
  assert(
    /Your own keys answer first, with no daily limit/.test(v.headline) &&
      /free answers behind them/.test(v.headline),
    v.headline,
  );
  assert(/asks before switching to free/.test(v.freePool.consequence), v.freePool.consequence);
});

check("own keys: what the vendor says is left on the person's own account", () => {
  const at = NOON.getTime();
  const read = (over: Partial<QuotaReadingRow>) =>
    describeQuota(
      {
        provider: "groq",
        model: "openai/gpt-oss-120b",
        scope: "requests",
        window: "day",
        quotaLimit: 1_000,
        remaining: 840,
        resetAt: new Date(at + 9 * 3_600_000),
        observedAt: new Date(at - 60_000),
        source: "headers",
        note: null,
        ...over,
      },
      { now: at, nextProvider: null },
    );
  const key = (quota: QuotaRowView[]) =>
    userBudgetView(
      input({
        ownKeys: [
          {
            vendor: "groq",
            label: "Groq",
            model: "openai/gpt-oss-120b",
            billingUrl: null,
            limit: null,
            usage: null,
            quota,
          },
        ],
      }),
    ).ownKeys[0]!;

  const healthy = key([
    read({}),
    read({ scope: "tokens", window: "minute", quotaLimit: 8_000, remaining: 6_000 }),
  ]);
  assert(
    healthy.left?.line ===
      "On your Groq account: 840 of 1,000 requests left today · refills in 9 hours.",
    String(healthy.left?.line),
  );
  assert(healthy.left?.short === "840 of 1,000 requests left today", String(healthy.left?.short));
  assert(healthy.left?.spent === false, "a healthy account is not spent");

  // A spent counter leads whatever its window: it is the one refusing.
  const spent = key([read({}), read({ scope: "tokens", quotaLimit: 200_000, remaining: 0 })]);
  assert(spent.left?.spent === true, "spent");
  assert(
    /^Your Groq account is refusing for now: 0 of 200,000 tokens today · refills in 9 hours\.$/.test(
      spent.left!.line,
    ),
    spent.left!.line,
  );

  // Yesterday's reading with no reset says nothing about today — no sentence.
  const stale = key([read({ resetAt: null, observedAt: new Date(at - 86_400_000) })]);
  assert(stale.left === null, "a stale reading is not shown");
  assert(key([]).left === null, "nothing measured, nothing said");
});

check("midnight UTC is the reset, from any hour", () => {
  assert(
    nextUtcMidnight(new Date("2026-08-15T23:59:59Z")).toISOString() === "2026-08-16T00:00:00.000Z",
    "late",
  );
  assert(
    nextUtcMidnight(new Date("2026-08-15T00:00:00Z")).toISOString() === "2026-08-16T00:00:00.000Z",
    "exact midnight rolls to the next",
  );
});

check("meaning: pace is said only once there is a rate, and says whether the day lasts", () => {
  // No turns yet: nothing to project.
  assert(userBudgetView(input()).meaning.pace === null, "no pace before any turn");
  // Noon, 30k of a 100k share at 3 turns: 60k projected → lasts the day.
  const fine = userBudgetView(input({ userSpentTokens: 30_000, userTurns: 3 })).meaning.pace;
  assert(fine === "At today's pace your daily count lasts the whole day.", `${fine}`);
  // Noon, 60k spent: 120k projected → runs out at 100/120 of the day = 20:00.
  const hot = userBudgetView(input({ userSpentTokens: 60_000, userTurns: 30 })).meaning.pace;
  assert(hot !== null && /runs out around 20:00 UTC/.test(hot), `${hot}`);
  // Spent: no projection, the sentence on the pool already says it.
  assert(
    userBudgetView(input({ userSpentTokens: 95_000, userTurns: 10 })).meaning.pace === null,
    "spent",
  );
});

check("meaning: the week, memory and explanations are stated, with the levers that apply", () => {
  const v = userBudgetView(input({ week: { tokens: 84_000, turns: 12, days: 3 } }));
  assert(
    v.meaning.week?.line === "Last 7 days: 12 free answers, 84,000 tokens, on 3 days.",
    `${v.meaning.week?.line}`,
  );
  assert(
    /last 8 turns, each trimmed to about 600 characters/.test(v.meaning.memory.line),
    v.meaning.memory.line,
  );
  assert(
    v.meaning.explain.some((e) => e.title === "Why there is a daily count"),
    "the daily count explained",
  );
  assert(!v.meaning.explain.some((e) => e.title === "Your keys"), "no keys, no key explanation");
  assert(
    v.meaning.actions.map((a) => a.id).join(",") === "bring-key",
    `${v.meaning.actions.map((a) => a.id)}`,
  );
  assert(
    userBudgetView(input({ week: { tokens: 0, turns: 0, days: 0 } })).meaning.week === null,
    "an empty week is absent, not zero",
  );
  const paced = userBudgetView(input({ userSpentTokens: 72_000, userTurns: 30 }));
  assert(paced.meaning.actions[0]!.id === "wait", "paced leads with waiting");
  const keyed = userBudgetView(
    input({
      stance: "balanced",
      ownKeys: [
        {
          vendor: "xai",
          label: "xAI",
          model: "grok-4",
          billingUrl: null,
          limit: null,
          usage: null,
        },
      ],
    }),
  );
  assert(
    keyed.meaning.actions.map((a) => a.id).join(",") === "thrifty",
    `${keyed.meaning.actions.map((a) => a.id)}`,
  );
  assert(
    keyed.meaning.explain.some((e) => e.title === "Your keys"),
    "keys explained",
  );
  const thrifty = userBudgetView(
    input({
      stance: "thrifty",
      ownKeys: keyed.ownKeys.map((k) => ({ ...k, billingUrl: null, limit: null, usage: null })),
    }),
  );
  assert(thrifty.meaning.actions.length === 0, "already thrifty: nothing to press");
});

console.log(`\n${passed} checks passed`);
