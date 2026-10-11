/**
 * The person's own AI budget, as something they can read before they are
 * refused.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
 * Loki already kept every number: `ai_spend` holds what each person drew from
 * the shared free pool today, `fairShare` (ai-kit) decides their share of it,
 * `own_model_usage` counts what their own keys spent, and `provider_quota`
 * holds what each vendor last said was left. None of it was shown to the
 * person it was about. The one capacity page (Settings → AI, "The free pool")
 * is operator telemetry — vendor counters for the whole box — and the first
 * time a user met the rationing was the refusal itself: "you've used your
 * share of today's free AI budget". A budget you only learn about when it is
 * gone is not a budget, it is a wall with a sign on it.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────
 * One pure function from the ledgers to the screen, used by the Settings card,
 * the model picker and the assistant's own answer to "how much do I have left"
 * — so the three never disagree. Pure (no DB, no clock beyond `now`) for the
 * same reason the policy it reads is: it is testable with plain numbers, and
 * it is liftable into `@bitbaum/ai-kit` once a second app wants the same
 * screen — fair-share went exactly that way (written here, proved here, then
 * extracted).
 *
 * ── THE RULES IT KEEPS ───────────────────────────────────────────────────────
 * The same two the capacity page keeps. A number that implies no action is
 * decoration, so every source carries a sentence and a lever, not a bare
 * percentage. And it never pretends: a vendor nobody has heard from today is
 * unknown, not full; a share that pacing has not unlocked yet is "waiting
 * helps", which is a different fact from "spent".
 *
 * Answers are counted in the person's OWN measured cost where there is one —
 * tokens ÷ turns from their day — and only fall back to the fleet-wide
 * constant on their first turn or two. The `turns` column was added to the
 * ledger for exactly this, and this is the first reader of it.
 */

import { fairShare, utcDayElapsed } from "@/lib/ai-budget/fair-share";
import { ESTIMATED_TURN_TOKENS } from "@/lib/ai-budget/gate";
import { refillsIn, TOKENS_PER_ANSWER, type QuotaRowView } from "@/lib/ai/quota-view";

export type FreePoolState =
  /** Within the paced allowance: the next answer is admitted now. */
  | "ok"
  /** Within today's share but ahead of the pace — waiting unlocks more. */
  | "paced"
  /** The whole-day share is committed; waiting does not help today. */
  | "spent"
  /** Every vendor in the pool is out for everyone, whatever this person's share says. */
  | "pool-spent"
  /** No free provider is configured on this server at all. */
  | "none";

export type FreePoolBudget = {
  kind: "free-pool";
  state: FreePoolState;
  /** Their whole-day share, before pacing. */
  shareTokens: number;
  /** What they may have spent by now. */
  allowanceTokens: number;
  spentTokens: number;
  turnsToday: number;
  /** Tokens one answer costs, for the counts below. */
  tokensPerAnswer: number;
  /** True when `tokensPerAnswer` is this person's own measured mean, not the constant. */
  measured: boolean;
  /** Answers admissible right now, honouring the gate's own cost estimate at the edge. */
  answersNow: number;
  /** Answers left in today's share once the whole day has unlocked. */
  answersToday: number;
  /** 0..1 of the share already spent — the bar. */
  usedLevel: number;
  /** "in 12 minutes" when paced; null otherwise. */
  unlocksIn: string | null;
  /** When the day's budget refills — midnight UTC, in words. */
  resetsIn: string;
  activeUsers: number;
  /** "groq/openai/gpt-oss-120b" — the chain this share is spent across. */
  models: string[];
  /** The sentence. */
  line: string;
  /** The lever — what to do about it. */
  consequence: string;
};

export type OwnKeyBudget = {
  kind: "own-key";
  vendor: string;
  /** The vendor's name, or the name the person gave their own endpoint. */
  label: string;
  model: string;
  tokensToday: number;
  callsToday: number;
  tokens30d: number;
  calls30d: number;
  line: string;
  consequence: string;
  /** Where the person funds this key and caps it. Null when the vendor has no such page. */
  billingUrl: string | null;
};

/** What a vendor last said about one model in the free pool — for the picker row. */
export type ModelHeadroom = {
  /** `${provider}/${model}`, the picker's own key for a free-chain row. */
  id: string;
  provider: string;
  model: string;
  state: QuotaRowView["state"];
  /** One line when there is something to say; null when the model is simply available. */
  note: string | null;
};

export type BudgetView = {
  /** One line for a strip or a chat answer. */
  headline: string;
  freePool: FreePoolBudget;
  ownKeys: OwnKeyBudget[];
  models: ModelHeadroom[];
  /** When the free pool refills, as an ISO instant, for a client that wants a countdown. */
  resetsAt: string;
};

export type BudgetInput = {
  now: Date;
  dayCapacityTokens: number;
  activeUsers: number;
  userSpentTokens: number;
  userTurns: number;
  /** The usable free chain, in order. */
  chain: { provider: string; model: string }[];
  /** One binding row per free-chain model, as `bindingRows` produces them. */
  vendorRows: QuotaRowView[];
  ownKeys: {
    vendor: string;
    label: string;
    model: string;
    billingUrl: string | null;
    /** The vendor's own word for its spending cap ("usage limit"), or null. */
    limit: string | null;
    usage: { tokensToday: number; callsToday: number; tokens30d: number; calls30d: number } | null;
  }[];
};

/** Bounds on a measured per-answer cost, so one odd day cannot make the count absurd. */
const MEASURED_MIN = 1_000;
const MEASURED_MAX = 60_000;
/** A mean needs more than one sample before it is called a measurement. */
const MEASURED_AFTER_TURNS = 2;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

/** Next midnight UTC — when every daily free tier and the share both reset. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

/**
 * How many answers `tokens` buys, counted the way the gate will actually
 * admit them: each turn must still fit the gate's ESTIMATE before it starts,
 * and then costs what the person's turns really cost. So the count is the
 * number of successive admissions — one while the estimate fits, plus one for
 * every real answer's worth of room above it — never a bare division, which
 * would promise ten cheap answers on a remainder the gate refuses after one.
 */
function answersIn(tokens: number, perAnswer: number): number {
  if (tokens < ESTIMATED_TURN_TOKENS) return 0;
  return 1 + Math.floor((tokens - ESTIMATED_TURN_TOKENS) / perAnswer);
}

const OWN_KEY_LEVER = "Bring your own key and the daily share no longer applies to your chats.";

function freePool(input: BudgetInput, hasOwnKeys: boolean): FreePoolBudget {
  const now = input.now.getTime();
  const spent = Math.max(0, input.userSpentTokens);
  const turns = Math.max(0, input.userTurns);
  const measured = turns >= MEASURED_AFTER_TURNS && spent > 0;
  const tokensPerAnswer = measured
    ? Math.min(MEASURED_MAX, Math.max(MEASURED_MIN, Math.round(spent / turns)))
    : TOKENS_PER_ANSWER;

  const decision = fairShare({
    dayCapacityTokens: input.dayCapacityTokens,
    activeUsers: input.activeUsers,
    userSpentTokens: spent,
    costTokens: ESTIMATED_TURN_TOKENS,
    dayElapsed: utcDayElapsed(input.now),
  });

  const resetsIn = refillsIn(nextUtcMidnight(input.now), now) ?? "at midnight UTC";
  const models = input.chain.map((l) => `${l.provider}/${l.model}`);
  const answersNow = decision.allowed
    ? answersIn(decision.allowanceTokens - spent, tokensPerAnswer)
    : 0;
  const answersToday = answersIn(decision.shareTokens - spent, tokensPerAnswer);
  const usedLevel = decision.shareTokens > 0 ? clamp01(spent / decision.shareTokens) : 0;

  // Vendor truth outranks the share: a share of a pool every vendor has
  // refused is a number with nothing behind it. Only an EXHAUSTED reading on
  // every model counts — an unknown one is not a refusal.
  const chainRows = input.vendorRows.filter((r) => models.includes(`${r.provider}/${r.model}`));
  const poolSpent =
    models.length > 0 &&
    chainRows.length >= models.length &&
    chainRows.every((r) => r.state === "exhausted");
  const poolBack = chainRows.map((r) => r.refills).find((r): r is string => typeof r === "string");

  const base = {
    kind: "free-pool" as const,
    shareTokens: Math.round(decision.shareTokens),
    allowanceTokens: Math.round(decision.allowanceTokens),
    spentTokens: spent,
    turnsToday: turns,
    tokensPerAnswer,
    measured,
    usedLevel,
    resetsIn,
    activeUsers: Math.max(1, Math.floor(input.activeUsers) || 1),
    models,
  };

  // With keys, the pool is the fallback; the lever is to keep it that way.
  const lever = hasOwnKeys
    ? "Your keys answer first, so this is only what catches a turn they miss."
    : OWN_KEY_LEVER;

  if (decision.reason === "no-capacity") {
    return {
      ...base,
      state: "none",
      answersNow: 0,
      answersToday: 0,
      unlocksIn: null,
      line: "No free pool on this server — there is nothing to share.",
      consequence: hasOwnKeys
        ? "Your keys are the only thing answering here."
        : "Bring your own key and Loki answers on it.",
    };
  }

  if (poolSpent) {
    return {
      ...base,
      state: "pool-spent",
      answersNow: 0,
      answersToday,
      unlocksIn: null,
      line: `The whole free pool is spent for today${poolBack ? `, back ${poolBack}` : ""} — every vendor, not just your share.`,
      consequence: lever,
    };
  }

  if (decision.reason === "share-spent" || answersToday === 0) {
    return {
      ...base,
      state: "spent",
      answersNow: 0,
      answersToday: 0,
      unlocksIn: null,
      line: `Your share for today is spent — it resets ${resetsIn}.`,
      consequence: lever,
    };
  }

  if (decision.reason === "paced") {
    const unlocksIn =
      decision.retryAfterSeconds !== undefined
        ? (refillsIn(new Date(now + decision.retryAfterSeconds * 1000), now) ?? "soon")
        : null;
    return {
      ...base,
      state: "paced",
      answersNow: 0,
      answersToday,
      unlocksIn,
      line:
        `Your share for now is used up — the next answer unlocks ${unlocksIn ?? "soon"}, ` +
        `and about ${plural(answersToday, "more")} ${answersToday === 1 ? "is" : "are"} yours by the end of the day.`,
      consequence: `It unlocks through the day so everyone here gets a turn. ${lever}`,
    };
  }

  const pacedTail =
    answersToday > answersNow
      ? ` — the rest unlocks through the day so everyone here gets a turn`
      : "";
  return {
    ...base,
    state: "ok",
    answersNow,
    answersToday,
    unlocksIn: null,
    line:
      `About ${plural(answersNow, "more answer")} now, ${count(answersToday)} by the end of the day` +
      `${pacedTail} · resets ${resetsIn}.`,
    consequence: lever,
  };
}

function ownKey(k: BudgetInput["ownKeys"][number]): OwnKeyBudget {
  const u = k.usage;
  const line =
    !u || u.calls30d === 0
      ? "Nothing spent on it yet."
      : `Today ${count(u.tokensToday)} tokens in ${plural(u.callsToday, "answer")} · ` +
        `30 days ${count(u.tokens30d)} tokens in ${plural(u.calls30d, "answer")}.`;
  const cap = k.limit ? ` — set a ${k.limit} there and it protects you whatever Loki does` : "";
  return {
    kind: "own-key",
    vendor: k.vendor,
    label: k.label,
    model: k.model,
    tokensToday: u?.tokensToday ?? 0,
    callsToday: u?.callsToday ?? 0,
    tokens30d: u?.tokens30d ?? 0,
    calls30d: u?.calls30d ?? 0,
    line,
    consequence: `No cap from Loki — ${k.label} bills you directly${cap}.`,
    billingUrl: k.billingUrl,
  };
}

/** What a vendor's counter means for one row of the picker, or nothing when it is simply fine. */
export function headroomNote(row: QuotaRowView): string | null {
  switch (row.state) {
    case "exhausted":
      return row.shortfall
        ? `Too low for another answer${row.refills ? `, refills ${row.refills}` : ""} — Auto moves past it`
        : `Out of free budget${row.refills ? `, back ${row.refills}` : ""} — Auto moves past it`;
    case "skipped":
      return "Never reached — prompts exceed its budget";
    case "known":
      if (!row.urgent || row.answers === null) return null;
      return `Running low — about ${plural(row.answers, row.unitNoun?.replace(/s$/, "") ?? "answer")} left${row.refills ? `, refills ${row.refills}` : ""}`;
    case "unknown":
      return null;
  }
}

function headline(pool: FreePoolBudget, ownKeys: OwnKeyBudget[]): string {
  if (ownKeys.length > 0) {
    const behind =
      pool.state === "none"
        ? "no free pool behind them on this server"
        : pool.state === "pool-spent" || pool.state === "spent"
          ? "the free pool behind them is spent for today"
          : `about ${plural(pool.answersToday, "free answer")} behind them today`;
    return `Your keys answer first, with no cap from Loki — ${behind}.`;
  }
  switch (pool.state) {
    case "ok":
      return `About ${plural(pool.answersNow, "free answer")} left now, ${count(pool.answersToday)} today · resets ${pool.resetsIn}.`;
    case "paced":
      return `Your free share for now is used up — more unlocks ${pool.unlocksIn ?? "soon"}.`;
    case "spent":
      return `Your free share for today is spent — resets ${pool.resetsIn}.`;
    case "pool-spent":
      return "The free pool is spent for everyone today.";
    case "none":
      return "No free pool on this server.";
  }
}

/** The person's budget across every source they can draw on, from the ledgers to the screen. */
export function userBudgetView(input: BudgetInput): BudgetView {
  const ownKeys = input.ownKeys.map(ownKey);
  const pool = freePool(input, ownKeys.length > 0);
  const chainIds = new Set(pool.models);
  const models: ModelHeadroom[] = input.vendorRows
    .filter((r) => chainIds.has(`${r.provider}/${r.model}`))
    .map((r) => ({
      id: `${r.provider}/${r.model}`,
      provider: r.provider,
      model: r.model,
      state: r.state,
      note: headroomNote(r),
    }));
  return {
    headline: headline(pool, ownKeys),
    freePool: pool,
    ownKeys,
    models,
    resetsAt: nextUtcMidnight(input.now).toISOString(),
  };
}
