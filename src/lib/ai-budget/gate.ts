import { fairShare, utcDayElapsed, type ShareDecision } from "@/lib/ai-budget/fair-share";
import { freeDayCapacityTokens } from "@/lib/ai/free-capacity";
import { humanizeWait } from "@/lib/agent/groq-error";
import type { DayUsage } from "@/db/queries/ai-spend";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";
import { nextUtcMidnight } from "@bitbaum/ai-kit";
import { atClock } from "@/lib/ai/clock-words";
import { readAllowanceLeft } from "@/lib/ai-budget/plan-allowance";

/**
 * The ledger is imported LAZILY, for the same reason `loop.ts` does it: `@/db`
 * throws at MODULE INIT when no connection string is set, so a static import
 * here would make this file impossible to load in the env-independent test tier
 * — and the behaviour most worth testing (that a ledger failure still admits
 * the turn) is exactly what needs loading it without a database.
 */
async function ledger() {
  return import("@/db/queries/ai-spend");
}

/** Lazily, for the same reason as the ledger: only a refusal needs it. */
async function personZone(userId: string, now: Date): Promise<string> {
  const [{ getUserPreferences }, { effectiveTimeZone }] = await Promise.all([
    import("@/db/queries/user-preferences"),
    import("@/lib/agent/now-line"),
  ]);
  return effectiveTimeZone(await getUserPreferences(userId), now);
}

/**
 * The admission gate: policy (fair-share.ts) + ledger (db/queries/ai-spend.ts).
 *
 * Kept separate from both so the policy stays pure and portable, and so
 * `loki-core` gains two function calls rather than an accounting subsystem.
 */

/**
 * What a turn is assumed to cost before it runs.
 *
 * Admission has to decide BEFORE the provider reports anything, so this is an
 * estimate, and it must err HIGH: under-estimating admits turns the budget
 * cannot actually cover, which drains the pool early and produces the
 * late-in-the-day wall the rationing exists to prevent. The ACTUAL cost is
 * recorded afterwards from the provider's own count, so this only ever governs
 * admission, never the books.
 *
 * MEASURED, not guessed. The first turn to reach the ledger in production cost
 * 15,839 tokens (one tool call, `list_pending_approvals`, answered on
 * openrouter/openai/gpt-oss-20b:free). The original 10,000 was written as
 * "deliberately on the high side" and was in fact ~37% BELOW a single observed
 * turn — an estimate erring in exactly the wrong direction, and wrong on the
 * first sample rather than at some tail.
 *
 * 20k carries margin over that observation because it is ONE sample of the
 * cheap shape: a turn that calls several tools, or runs the repair pass, spends
 * more. The `turns` column in `ai_spend` exists so this can be replaced by a
 * measured mean once there is enough traffic to compute one — at which point
 * this constant should become a query, not a better guess.
 */
export const ESTIMATED_TURN_TOKENS = 20_000;

/** Turns of a person's own day before their mean is trusted over the estimate. */
export const MEASURED_AFTER_TURNS = 2;
/** Margin over the measured mean: admission must still err high. */
const RESERVE_MARGIN = 1.25;
/** Below this a "mean" is an artefact (one cached reply), not a turn's cost. */
const RESERVE_FLOOR = 5_000;

/**
 * What admission holds back for the next turn: this person's own measured mean
 * cost today plus a margin, never above the estimate above and never below a
 * floor; the estimate until two turns have been measured.
 *
 * Why: the "answers left" count already divided by the measured mean while
 * admission kept reserving 20,000 — so with 12,000 tokens of share left and
 * answers costing 9,000, the count said "1 left" and the gate said no. The
 * last part of every share went unused (seen 2026-10-17: the test account
 * shown "17 left" ran out early). Capped at the estimate, so no one is ever
 * reserved MORE than before; the margin keeps it erring high, as above.
 */
export function turnReserveTokens(spentTokens: number, turns: number): number {
  if (turns < MEASURED_AFTER_TURNS || spentTokens <= 0) return ESTIMATED_TURN_TOKENS;
  const mean = spentTokens / turns;
  return Math.round(
    Math.min(ESTIMATED_TURN_TOKENS, Math.max(RESERVE_FLOOR, mean * RESERVE_MARGIN)),
  );
}

export type BudgetVerdict =
  { allowed: true } | { allowed: false; message: string; retryAfterSeconds?: number };

/** Turn a refusal into something the operator can act on. */
/** Where the plans are: the reason the pool is shared, and the way past it that costs money. */
const PLANS_PATH = "/pricing";

/**
 * The way past the shared pool, offered at the moment it is needed. A refusal
 * that only says "wait" leaves out the one thing that ends the wait now: the
 * person's own key, which Loki uses for their chats with no daily limit.
 */
const OWN_MODEL_OFFER = `Or [add your own model key](${OWN_MODEL_SETTINGS_PATH}) from any provider you use — your chats then have no daily limit. A [paid plan](${PLANS_PATH}) will add a monthly allowance with no daily wait.`;

/**
 * Plain words and a clock time. This used to say "you've used your share of
 * today's free AI budget for now. It tops up through the day… try again in 19
 * minutes" while the picker said "resets in 8 hours" — the person who read
 * both (2026-10-15) could not tell what either meant. The same sentences as
 * the picker (budget-view.ts), so the two cannot disagree.
 */
function explain(decision: ShareDecision, now: Date, timeZone: string | null): string {
  switch (decision.reason) {
    case "paced": {
      const at =
        decision.retryAfterSeconds !== undefined
          ? atClock(new Date(now.getTime() + decision.retryAfterSeconds * 1000), now, timeZone)
          : null;
      const wait = at ? null : humanizeWait(decision.retryAfterSeconds ?? null);
      // Says WHY there is a wait, not just that there is one — a reason a
      // person accepts; an unexplained refusal reads as breakage.
      return `No free answer is ready right now — the next one is ready ${at ?? (wait ? `in ${wait}` : "soon")}. Free answers come in through the day so that people who arrive later still get some. ${OWN_MODEL_OFFER}`;
    }
    case "share-spent":
      // No retry offered: waiting cannot help today, and saying otherwise is the
      // same lie as "try again shortly" on an exhausted daily quota.
      return `No free answers left today — full again ${atClock(nextUtcMidnight(now), now, timeZone)} (midnight UTC). ${OWN_MODEL_OFFER}`;
    case "no-capacity":
      return `No AI provider is configured on this server. [Connect your own model](${OWN_MODEL_SETTINGS_PATH}) to use Loki now.`;
    case "ok":
      return "";
  }
}

/**
 * May this user take a turn now?
 *
 * FAILS OPEN. If the ledger cannot be read, the correct answer is to let the
 * turn through: this is a rationing nicety, and a database hiccup must not
 * become an outage of the assistant itself. A guard that reads state to answer
 * a QUESTION must never turn that question into a fatal step.
 */
export async function checkAiBudget(
  userId: string,
  now = new Date(),
  /**
   * Injectable seams, same reasoning as the loop's `ModelCaller`: the behaviour
   * worth pinning here (which refusal, whether it fails open) is decided by this
   * function, not by Postgres, and a test that needs a database to prove
   * "a ledger error must not become an outage" will not be written.
   */
  deps: {
    readUsage?: (userId: string, now: Date) => Promise<DayUsage>;
    capacity?: () => number | Promise<number>;
    /** Tokens left on the person's paid plan this month (lib/ai-budget/plan-allowance.ts). */
    planAllowance?: (userId: string, now: Date) => Promise<number>;
    /** The person's zone for the clock time in a refusal; read from their settings when absent. */
    timeZone?: string | null;
  } = {},
): Promise<BudgetVerdict> {
  try {
    const capacity = await (deps.capacity ?? freeDayCapacityTokens)();
    const readUsage =
      deps.readUsage ?? (async (u: string, n: Date) => (await ledger()).getDayUsage(u, n));
    const { userSpentTokens, userTurns, activeUsers } = await readUsage(userId, now);

    const costTokens = turnReserveTokens(userSpentTokens, userTurns ?? 0);
    const decision = fairShare({
      dayCapacityTokens: capacity,
      activeUsers,
      userSpentTokens,
      costTokens,
      dayElapsed: utcDayElapsed(now),
    });

    if (decision.allowed) return { allowed: true };
    // Past the share, a paid plan's month still admits the turn. Read only
    // here, so a free turn never pays for it; a read that fails is no
    // allowance, never an outage — the share's refusal stands.
    if (decision.reason !== "no-capacity") {
      const left = await (deps.planAllowance ?? readAllowanceLeft)(userId, now).catch(() => 0);
      if (left >= costTokens) return { allowed: true };
    }
    // Only a refusal that names a time needs the person's zone, and only then
    // is their settings row read.
    const timeZone =
      deps.timeZone !== undefined || decision.reason === "no-capacity"
        ? (deps.timeZone ?? null)
        : await personZone(userId, now).catch(() => null);
    return {
      allowed: false,
      message: explain(decision, now, timeZone),
      ...(decision.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: decision.retryAfterSeconds }
        : {}),
    };
  } catch (e) {
    console.error(
      "[ai-budget] check failed, admitting the turn:",
      e instanceof Error ? e.message : e,
    );
    return { allowed: true };
  }
}

/**
 * Book what the turn actually cost, as the provider counted it.
 *
 * Best-effort by the same reasoning as the check: an answer already delivered
 * must not be turned into an error because the ledger write failed. A missing
 * write costs the pool a little accuracy; a thrown one costs the user their
 * answer.
 *
 * `tokens` of 0 means the provider reported no usage — recorded as the estimate
 * rather than as free, since a turn that reached a model was never free and
 * booking it at zero would let an unreporting provider drain the day invisibly.
 */
export async function recordAiSpend(
  userId: string,
  tokens: number,
  now = new Date(),
): Promise<void> {
  try {
    const { recordSpend } = await ledger();
    await recordSpend(userId, tokens > 0 ? tokens : ESTIMATED_TURN_TOKENS, now);
  } catch (e) {
    console.error("[ai-budget] record failed:", e instanceof Error ? e.message : e);
  }
}
