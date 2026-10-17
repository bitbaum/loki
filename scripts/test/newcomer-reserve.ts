/**
 * A first-time visitor never meets an empty pool.
 *
 * Returning accounts together stop at 80% of the day's free capacity; an
 * account under a week old may draw on the rest, under its own fair share.
 * The gate and the budget screen must say the same thing about it.
 *
 * Pure: no database (the gate's reads are injected).
 */
import { checkAiBudget } from "@/lib/ai-budget/gate";
import {
  isNewcomer,
  NEWCOMER_DAYS,
  NEWCOMER_RESERVE,
  reachesReserve,
} from "@/lib/ai-budget/newcomer-reserve";
import { userBudgetView } from "@/lib/ai/budget-view";
import { DAY_MS } from "@/lib/constants/time";

let passed = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond)
    throw new Error(`✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const NOW = new Date("2026-10-17T20:00:00Z");
const CAPACITY = 1_000_000;
const lateDay = async () => ({
  userSpentTokens: 0,
  userTurns: 0,
  activeUsers: 10,
  // Past the returning accounts' 80%.
  totalSpentTokens: CAPACITY * (1 - NEWCOMER_RESERVE) - 5_000,
});
const old = async () => new Date(NOW.getTime() - 30 * DAY_MS);
const fresh = async () => new Date(NOW.getTime() - DAY_MS);

async function main() {
  check("a reserve is held", NEWCOMER_RESERVE > 0 && NEWCOMER_RESERVE < 0.5);
  check("an account made yesterday is new", isNewcomer(new Date(NOW.getTime() - DAY_MS), NOW));
  check(
    "one older than the window is not",
    !isNewcomer(new Date(NOW.getTime() - (NEWCOMER_DAYS + 1) * DAY_MS), NOW),
  );
  check("an unknown age is not new", !isNewcomer(null, NOW));
  check("early in the day nothing reaches the reserve", !reachesReserve(CAPACITY, 100_000, 20_000));
  check("no capacity is not a reserve question", !reachesReserve(0, 0, 20_000));

  const returning = await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => CAPACITY,
    readUsage: lateDay,
    accountCreatedAt: old,
    planAllowance: async () => 0,
  });
  check("a returning account is refused once the day reaches the reserve", !returning.allowed);
  check(
    "…told why, when it fills again, and the ways past it",
    !returning.allowed &&
      /kept for people trying Loki for the first time/.test(returning.message) &&
      /own model key/.test(returning.message) &&
      /\(\/pricing\)/.test(returning.message),
    returning,
  );

  const newcomer = await checkAiBudget("u2", NOW, {
    timeZone: "UTC",
    capacity: () => CAPACITY,
    readUsage: lateDay,
    accountCreatedAt: fresh,
  });
  check("an account under a week old still gets an answer", newcomer.allowed);

  const paid = await checkAiBudget("u3", NOW, {
    timeZone: "UTC",
    capacity: () => CAPACITY,
    readUsage: lateDay,
    accountCreatedAt: old,
    planAllowance: async () => 5_000_000,
  });
  check("a paid plan with allowance left is not held back", paid.allowed);

  let read = false;
  await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => CAPACITY,
    readUsage: async () => ({ ...(await lateDay()), totalSpentTokens: 10_000 }),
    accountCreatedAt: async () => {
      read = true;
      return null;
    },
  });
  check("an ordinary turn never reads the account's age", !read);

  const broken = await checkAiBudget("u1", NOW, {
    timeZone: "UTC",
    capacity: () => CAPACITY,
    readUsage: lateDay,
    accountCreatedAt: async () => {
      throw new Error("connection refused");
    },
    planAllowance: async () => 0,
  });
  check("an age that cannot be read admits the turn — the gate fails open", broken.allowed);

  const view = (newcomerFlag: boolean) =>
    userBudgetView({
      now: NOW,
      dayCapacityTokens: CAPACITY,
      activeUsers: 10,
      userSpentTokens: 0,
      userTurns: 0,
      chain: [{ provider: "groq", model: "openai/gpt-oss-120b" }],
      vendorRows: [],
      ownKeys: [],
      memory: { turns: 8, charsPerTurn: 600 },
      totalSpentTokens: CAPACITY * (1 - NEWCOMER_RESERVE) - 5_000,
      newcomer: newcomerFlag,
    }).freePool;
  const r = view(false);
  check(
    "the budget screen says the same to a returning account",
    r.state === "spent" && r.answersNow === 0 && /first time/.test(r.line),
    r,
  );
  check("…and still counts answers for a newcomer", view(true).answersNow > 0);

  console.log(`\nnewcomer-reserve: ${passed} checks passed`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
