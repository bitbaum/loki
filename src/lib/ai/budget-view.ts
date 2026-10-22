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

import {
  admissionsLeft,
  countOf,
  historyWindowLine,
  nextUtcMidnight,
  paceForecast,
  paceLine as phrasePace,
  type UsageAction,
  type UsageExplanation,
  utcResetExplanation,
} from "@bitbaum/ai-kit";
import { fairShare, utcDayElapsed } from "@/lib/ai-budget/fair-share";
import { MEASURED_AFTER_TURNS, turnReserveTokens } from "@/lib/ai-budget/gate";
import { ownKeyLeft, type OwnKeyLeft } from "@/lib/ai/own-key-quota";
import { reachesReserve } from "@/lib/ai-budget/newcomer-reserve";
import { refillsIn, TOKENS_PER_ANSWER, type QuotaRowView } from "@/lib/ai/quota-view";
import { atClock } from "@/lib/ai/clock-words";

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
  /** When the next answer frees up, as a clock time ("at 13:35"); null unless paced. */
  nextAt: string | null;
  /** When the day starts over, as a clock time ("tomorrow at 02:00"). */
  fullAgainAt: string;
  /** Two or three words for the composer's model button ("12 left"); null when there is nothing to count. */
  short: string | null;
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
  /** What the vendor last said is left on the person's account. Null until it has said. */
  left: OwnKeyLeft | null;
  consequence: string;
  /** Where the person funds this key and caps it. Null when the vendor has no such page. */
  billingUrl: string | null;
};

/** One free model, for its picker row: what the vendor last said, and what is left on it. */
export type ModelHeadroom = {
  /** `${provider}/${model}`, the picker's own key for a free-chain row. */
  id: string;
  provider: string;
  model: string;
  state: QuotaRowView["state"];
  /** One line when there is something to say; null when the model is simply available. */
  note: string | null;
  /**
   * What is left on THIS model, always — "12 left today", "None left · back
   * in 3 hours". Every row says it, not only a row about to run out: a person
   * running several things wants the number before they pick, not after.
   */
  left: string;
};

/** One thing the person can do about the numbers, in order of use right now. */
export type BudgetAction = UsageAction<"bring-key" | "thrifty" | "wait" | "plans">;

/**
 * What the numbers MEAN — the half a meter leaves out. A usage screen that
 * says "57% used, resets in 1 h 33 min" is accurate and tells you nothing you
 * can do: whether that pace lasts the day, what the limit is a limit OF, why
 * it moves, and what to press. This is that half, stated once here so the
 * card, the picker and the assistant say the same words.
 */
export type BudgetMeaning = {
  /** "At today's pace your share lasts the day" or "…runs out around 16:40 UTC". Null before two turns. */
  pace: string | null;
  /** The last seven UTC days on the free pool, or null when nothing was recorded. */
  week: { tokens: number; turns: number; days: number; line: string } | null;
  /** What Loki carries from one turn to the next — stated, because an unstated limit is a bug report. */
  memory: { turns: number; charsPerTurn: number; line: string };
  /** Each number in plain words, for a "What this means" disclosure. */
  explain: UsageExplanation[];
  actions: BudgetAction[];
};

export type BudgetView = {
  /** One line for a strip or a chat answer. */
  headline: string;
  freePool: FreePoolBudget;
  ownKeys: OwnKeyBudget[];
  models: ModelHeadroom[];
  meaning: BudgetMeaning;
  /** When the free pool refills, as an ISO instant, for a client that wants a countdown. */
  resetsAt: string;
  /** The person's paid plan allowance this month, as a source of its own. Null on Free. */
  plan: { name: string; answersMonthly: number; answersLeft: number; line: string } | null;
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
    /** This vendor's counters on the person's own account, described (lib/ai/quota-view.ts). */
    quota?: QuotaRowView[];
  }[];
  /** The last seven UTC days on the free pool, today included. Absent when the ledger could not be read. */
  week?: { tokens: number; turns: number; days: number };
  /** What the loop carries between turns (HISTORY_TURNS / HISTORY_CHARS_PER_TURN in lib/agent/loop.ts). */
  memory: { turns: number; charsPerTurn: number };
  /** How Auto spends the person's own keys; "thrifty" is the lever this view can offer. */
  stance?: "thrifty" | "balanced" | "best";
  /** The person's zone, so times read as their clock ("at 13:35"). Default: the server's. */
  timeZone?: string | null;
  /** Everyone's tokens today, and whether this account is new — the newcomer reserve's inputs. */
  totalSpentTokens?: number;
  newcomer?: boolean;
  /** A paid plan's monthly allowance (lib/ai-budget/plan-allowance.ts). Absent on Free. */
  plan?: { name: string; answersMonthly: number; answersLeft: number } | null;
};

/** Bounds on a measured per-answer cost, so one odd day cannot make the count absurd. */
const MEASURED_MIN = 1_000;
const MEASURED_MAX = 60_000;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => countOf(n, word, { format: count });

/**
 * Answers `tokens` buys, counted the way the gate admits them — the rule lives
 * in @bitbaum/ai-kit (`admissionsLeft`) so every app counts a remainder alike.
 */
function answersIn(tokens: number, reserve: number, perAnswer: number): number {
  return admissionsLeft(tokens, reserve, perAnswer);
}

const OWN_KEY_LEVER = "Add your own model key and there is no daily limit on your chats.";

function freePool(input: BudgetInput, hasOwnKeys: boolean): FreePoolBudget {
  const now = input.now.getTime();
  const spent = Math.max(0, input.userSpentTokens);
  const turns = Math.max(0, input.userTurns);
  const measured = turns >= MEASURED_AFTER_TURNS && spent > 0;
  const tokensPerAnswer = measured
    ? Math.min(MEASURED_MAX, Math.max(MEASURED_MIN, Math.round(spent / turns)))
    : TOKENS_PER_ANSWER;

  // The same reserve the gate admits against, so the count and the gate agree.
  const reserve = turnReserveTokens(spent, turns);
  const decision = fairShare({
    dayCapacityTokens: input.dayCapacityTokens,
    activeUsers: input.activeUsers,
    userSpentTokens: spent,
    costTokens: reserve,
    dayElapsed: utcDayElapsed(input.now),
  });

  const resetsIn = refillsIn(nextUtcMidnight(input.now), now) ?? "at midnight UTC";
  const fullAgainAt = atClock(nextUtcMidnight(input.now), input.now, input.timeZone);
  const models = input.chain.map((l) => `${l.provider}/${l.model}`);
  const answersNow = decision.allowed
    ? answersIn(decision.allowanceTokens - spent, reserve, tokensPerAnswer)
    : 0;
  const answersToday = answersIn(decision.shareTokens - spent, reserve, tokensPerAnswer);
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
    fullAgainAt,
    nextAt: null as string | null,
  };

  // With keys, the pool is the fallback; the lever is to keep it that way.
  const lever = hasOwnKeys
    ? "Auto uses your own keys first. Choosing a free model uses this daily count; if your key fails, Loki asks before switching to free."
    : OWN_KEY_LEVER;

  if (decision.reason === "no-capacity") {
    return {
      ...base,
      state: "none",
      answersNow: 0,
      answersToday: 0,
      unlocksIn: null,
      short: null,
      line: "No free models on this server.",
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
      short: "0 left",
      line: `The free models are used up for everyone today${poolBack ? ` — back ${poolBack}` : ""}. Not just you: every free model.`,
      consequence: lever,
    };
  }

  // The gate's newcomer reserve (lib/ai-budget/newcomer-reserve.ts), read the
  // same way, so this screen never says "12 left" to someone it will refuse.
  if (
    decision.allowed &&
    !input.newcomer &&
    !(input.plan && input.plan.answersLeft > 0) &&
    reachesReserve(input.dayCapacityTokens, input.totalSpentTokens ?? 0, reserve)
  ) {
    return {
      ...base,
      state: "spent",
      answersNow: 0,
      answersToday: 0,
      unlocksIn: null,
      short: "0 left",
      line: `Today's free answers for returning accounts are used up — the rest is kept for people trying Loki for the first time. Full again ${fullAgainAt}.`,
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
      short: "0 left",
      line: `No free answers left today — full again ${fullAgainAt}.`,
      consequence: lever,
    };
  }

  if (decision.reason === "paced") {
    const unlocksIn =
      decision.retryAfterSeconds !== undefined
        ? (refillsIn(new Date(now + decision.retryAfterSeconds * 1000), now) ?? "soon")
        : null;
    const nextAt =
      decision.retryAfterSeconds !== undefined
        ? atClock(new Date(now + decision.retryAfterSeconds * 1000), input.now, input.timeZone)
        : null;
    return {
      ...base,
      state: "paced",
      answersNow: 0,
      answersToday,
      unlocksIn,
      nextAt,
      short: nextAt ? `next ${nextAt.replace(/^at /, "")}` : `${count(answersToday)} left`,
      line: `${plural(answersToday, "free answer")} left today — the next one ${nextAt ?? "soon"}.`,
      consequence: `They free up through the day, so whoever comes later still gets some. ${lever}`,
    };
  }

  const pacedTail =
    answersToday > answersNow
      ? ` (${count(answersNow)} right now, the rest free up through the day)`
      : "";
  return {
    ...base,
    state: "ok",
    answersNow,
    answersToday,
    unlocksIn: null,
    short: `${count(answersToday)} left`,
    line: `${plural(answersToday, "free answer")} left today${pacedTail} · full again ${fullAgainAt}.`,
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
  // The vendor's own word for its cap carries its article ("a monthly spending
  // limit", config/model-vendors.ts), so the sentence does not add one: "set a
  // a monthly spending limit" shipped on 2026-10-21.
  const cap = k.limit ? ` — set ${k.limit} there and it protects you whatever Loki does` : "";
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
    left: ownKeyLeft(k.quota ?? [], k.label, k.model),
    consequence: `No limit from Loki — ${k.label} bills you directly${cap}.`,
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
      return "Last request was too large for this model";
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
        ? "no free models behind them on this server"
        : pool.state === "pool-spent" || pool.state === "spent"
          ? "no free answers left behind them today"
          : `${plural(pool.answersToday, "free answer")} behind them today`;
    return `Your own keys answer first, with no daily limit from Loki — ${behind}.`;
  }
  return pool.line;
}

/** What is left on one free model, for its row — always a sentence, never blank. */
export function modelLeft(pool: FreePoolBudget, row: QuotaRowView | null): string {
  if (row?.state === "exhausted") {
    return row.refills ? `None left right now — back ${row.refills}` : "None left right now";
  }
  switch (pool.state) {
    case "none":
      return "Not set up on this server";
    case "pool-spent":
    case "spent":
      return `None left today — full again ${pool.fullAgainAt}`;
    case "paced":
      return `${count(pool.answersToday)} left today · next one ${pool.nextAt ?? "soon"}`;
    case "ok": {
      // Skipped is not empty: the count still stands, but this model could not
      // take the last request — saying only "17 left" hid why it was walked past.
      if (row?.state === "skipped") {
        return `${count(pool.answersToday)} left today · the last request was too large for it`;
      }
      const low =
        row?.state === "known" &&
        row.urgent &&
        row.answers !== null &&
        row.answers < pool.answersToday
          ? row.answers
          : null;
      return low !== null
        ? `Running low — about ${count(low)} left${row?.refills ? `, more ${row.refills}` : ""}`
        : `${count(pool.answersToday)} left today`;
    }
  }
}

/**
 * At today's rate, does the share last the day? Said only once there is a
 * rate to speak of — two turns (a sample counted in TURNS, not tokens) and a
 * few percent of the day. The forecast and its wording are @bitbaum/ai-kit's,
 * so Loki and OrangeCat forecast the same way.
 */
function paceLine(input: BudgetInput, pool: FreePoolBudget): string | null {
  if (pool.state !== "ok" && pool.state !== "paced") return null;
  if (pool.turnsToday < MEASURED_AFTER_TURNS) return null;
  return phrasePace(
    paceForecast({ used: pool.spentTokens, limit: pool.shareTokens, now: input.now, minUsed: 0 }),
    { subject: "your daily count", then: " — waits get longer before that, they do not stop you" },
  );
}

function meaningOf(
  input: BudgetInput,
  pool: FreePoolBudget,
  ownKeys: OwnKeyBudget[],
): BudgetMeaning {
  const week =
    input.week && input.week.turns > 0
      ? {
          ...input.week,
          // Seven days ending today, not a calendar week — so it does not say "this week".
          line: `Last 7 days: ${plural(input.week.turns, "free answer")}, ${count(input.week.tokens)} tokens, on ${plural(input.week.days, "day")}.`,
        }
      : null;

  const memory = {
    ...input.memory,
    line:
      historyWindowLine({
        assistant: "Loki",
        items: input.memory.turns,
        unit: "turn",
        trimmedChars: input.memory.charsPerTurn,
        format: count,
      }) + " Ask it to save a fact to memory and it lasts beyond that.",
  };

  const actions: BudgetAction[] = [];
  if (pool.state === "paced" && pool.unlocksIn) {
    actions.push({
      id: "wait",
      label: `Next one ${pool.nextAt ?? pool.unlocksIn}`,
      why: "Waiting is enough — you still have free answers today, the next one is just not ready yet.",
    });
  }
  if (ownKeys.length === 0 && pool.state !== "none") {
    actions.push({
      id: "bring-key",
      label: "Bring your own key",
      why: "Your chats run on your own account with that provider, with no daily limit from Loki.",
      href: "/models",
    });
  }
  if (!input.plan && pool.state !== "none" && pool.state !== "ok") {
    actions.push({
      id: "plans",
      label: "See plans",
      why: "A paid plan adds a monthly allowance of answers with no daily wait, on top of the free share.",
      href: "/pricing",
    });
  }
  if (ownKeys.length > 0 && input.stance && input.stance !== "thrifty") {
    actions.push({
      id: "thrifty",
      label: "Let Auto spend less",
      why: "Light turns go to your cheapest capable model; heavy ones still get the strong one.",
    });
  }

  const explain: BudgetMeaning["explain"] = [
    {
      title: "Answers, not tokens",
      body:
        "A token is a fragment of a word, and one answer costs a few thousand of them depending on how " +
        "much Loki has to read first. Tokens are what the vendors meter; answers are what you spend, so " +
        "the big number is answers and the tokens are underneath for checking.",
    },
    {
      title: "Why there is a daily count",
      body:
        "The free models are free because their makers give this server a fixed amount each day. " +
        "That amount is divided between everyone who uses Loki that day, so your count is higher on " +
        "a quiet day and lower on a busy one. All the free models draw on the same count.",
    },
    {
      title: "Why some answers wait",
      body:
        "If the whole day's answers could be used up before breakfast, there would be none left in " +
        "the evening. So they free up through the day: when you have to wait, the next one is ready " +
        "at the time shown. When none are left for today, the count starts over at midnight UTC.",
    },
    utcResetExplanation(),
    { title: "What Loki remembers", body: memory.line },
  ];
  if (ownKeys.length > 0) {
    explain.push({
      title: "Your keys",
      body:
        "A turn on your key never touches the pool. Loki counts its tokens so you can check the " +
        "vendor's invoice — it does not hold their price lists, so it never guesses a franc.",
    });
  }

  return { pace: paceLine(input, pool), week, memory, explain, actions };
}

/** The person's budget across every source they can draw on, from the ledgers to the screen. */
export function userBudgetView(input: BudgetInput): BudgetView {
  const ownKeys = input.ownKeys.map(ownKey);
  const pool = freePool(input, ownKeys.length > 0);
  const rowsById = new Map(input.vendorRows.map((r) => [`${r.provider}/${r.model}`, r]));
  // Every free model gets a row — one the vendor has said nothing about still
  // has the person's count on it. Only listing rows with a vendor reading left
  // most of the picker silent.
  const models: ModelHeadroom[] = input.chain.map((l) => {
    const id = `${l.provider}/${l.model}`;
    const r = rowsById.get(id) ?? null;
    return {
      id,
      provider: l.provider,
      model: l.model,
      state: r?.state ?? "unknown",
      note: r ? headroomNote(r) : null,
      left: modelLeft(pool, r),
    };
  });
  return {
    headline: headline(pool, ownKeys),
    freePool: pool,
    ownKeys,
    models,
    meaning: meaningOf(input, pool, ownKeys),
    resetsAt: nextUtcMidnight(input.now).toISOString(),
    plan: input.plan
      ? {
          name: input.plan.name,
          answersMonthly: input.plan.answersMonthly,
          answersLeft: Math.max(0, input.plan.answersLeft),
          line: planLine(input.plan),
        }
      : null,
  };
}

/** "Your Personal plan: 840 of 1,000 answers left this month." */
function planLine(p: NonNullable<BudgetInput["plan"]>): string {
  const left = Math.max(0, p.answersLeft);
  return left > 0
    ? `Your ${p.name} plan: ${count(left)} of ${count(p.answersMonthly)} answers left this month, past the daily free share.`
    : `Your ${p.name} plan's ${count(p.answersMonthly)} answers for this month are used — the free share still applies, and the allowance starts over on the 1st.`;
}
