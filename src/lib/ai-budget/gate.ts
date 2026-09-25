import { fairShare, utcDayElapsed, type ShareDecision } from "@/lib/ai-budget/fair-share";
import { dayCapacityTokens } from "@/config/chat-models";
import { humanizeWait } from "@/lib/agent/groq-error";
import type { DayUsage } from "@/db/queries/ai-spend";
import { OWN_MODEL_SETTINGS_PATH } from "@/lib/own-model-path";

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

export type BudgetVerdict =
  { allowed: true } | { allowed: false; message: string; retryAfterSeconds?: number };

/** Turn a refusal into something the operator can act on. */
/**
 * The way past the shared pool, offered at the moment it is needed. A refusal
 * that only says "wait" leaves out the one thing that ends the wait now: the
 * person's own key, which Loki uses for their chats with no daily limit.
 */
const OWN_MODEL_OFFER = `Or [connect your own model](${OWN_MODEL_SETTINGS_PATH}) with a key from any provider you use, and Loki's daily budget no longer applies to your chats.`;

function explain(decision: ShareDecision): string {
  switch (decision.reason) {
    case "paced": {
      const wait = humanizeWait(decision.retryAfterSeconds ?? null);
      // Says WHY there is a wait, not just that there is one — "you are being
      // rationed so someone else can also use this today" is a reason a person
      // accepts; an unexplained refusal reads as breakage.
      return `You've used your share of today's free AI budget for now. It tops up through the day so everyone gets a turn${wait ? ` — try again in ${wait}` : ""}. ${OWN_MODEL_OFFER}`;
    }
    case "share-spent":
      // No retry offered: waiting cannot help today, and saying otherwise is the
      // same lie as "try again shortly" on an exhausted daily quota.
      return `You've used your full share of today's free AI budget. It resets at midnight UTC. ${OWN_MODEL_OFFER}`;
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
    capacity?: () => number;
  } = {},
): Promise<BudgetVerdict> {
  try {
    const capacity = (deps.capacity ?? dayCapacityTokens)();
    const readUsage =
      deps.readUsage ?? (async (u: string, n: Date) => (await ledger()).getDayUsage(u, n));
    const { userSpentTokens, activeUsers } = await readUsage(userId, now);

    const decision = fairShare({
      dayCapacityTokens: capacity,
      activeUsers,
      userSpentTokens,
      costTokens: ESTIMATED_TURN_TOKENS,
      dayElapsed: utcDayElapsed(now),
    });

    if (decision.allowed) return { allowed: true };
    return {
      allowed: false,
      message: explain(decision),
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
