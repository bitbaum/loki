/**
 * Inline tests for the AI budget admission gate (lib/ai-budget/gate.ts) and the
 * day-capacity SSOT (config/chat-models.ts).
 *
 * The policy itself is covered by test:fair-share. What this pins is the part
 * that decides whether the product works when the plumbing does not:
 *
 *   - a ledger error must ADMIT the turn, never refuse it. Rationing is a
 *     nicety; a database hiccup turning into "Loki is down" is not a trade
 *     anyone would choose, and the guard-that-reads-state failure mode has
 *     already cost this fleet a day of blocked deploys.
 *   - capacity counts only providers we hold a key for, or users are rationed
 *     against tokens that cannot be reached.
 *   - the two refusals keep their distinct meanings all the way out to the
 *     message the user reads.
 *
 * Run: npm run test:ai-budget-gate
 */
import { checkAiBudget, ESTIMATED_TURN_TOKENS } from "@/lib/ai-budget/gate";
import { dayCapacityTokens, CHAT_CHAIN } from "@/config/chat-models";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = async (label: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const NOON = new Date("2026-08-15T12:00:00Z");
const KEYS: Record<string, string | undefined> = {
  GROQ_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  LOKI_GROQ_DAILY_TOKENS: undefined,
  LOKI_OPENROUTER_DAILY_TOKENS: undefined,
};

async function main() {
  // ── capacity SSOT ──────────────────────────────────────────────────────────
  await check("capacity counts ONLY providers we hold a key for", () => {
    withEnv({ ...KEYS }, () => {
      assert(dayCapacityTokens() === 0, "unkeyed providers contributed capacity");
    });
    withEnv({ ...KEYS, GROQ_API_KEY: "x" }, () => {
      const groq = CHAT_CHAIN.find((p) => p.id === "groq")!;
      assert(dayCapacityTokens() === groq.dailyTokens, `expected ${groq.dailyTokens}`);
    });
  });

  await check("capacity is the SUM across keyed vendors — that is the point of the chain", () => {
    // Keys derived from the chain rather than listed by hand. The previous
    // version set exactly GROQ + OPENROUTER and compared against the sum over
    // EVERY provider — the same thing only while the chain had exactly two
    // vendors. ai-kit 1.8.0 added Google as a third and this went red, which is
    // the gate doing its job: the assertion was about capacity, but it was
    // WRITTEN as an assumption about how many vendors exist.
    const allKeys = Object.fromEntries(CHAT_CHAIN.map((p) => [p.keyEnv, "x"]));
    withEnv({ ...KEYS, ...allKeys }, () => {
      const expected = CHAT_CHAIN.reduce((n, p) => n + p.dailyTokens, 0);
      assert(dayCapacityTokens() === expected, `expected ${expected}, got ${dayCapacityTokens()}`);
    });
  });

  await check("an UNKEYED vendor contributes nothing to the total", () => {
    // Only testable once a third vendor existed: with two, "all keyed" and
    // "some keyed" were the same set, so the subset case could not be stated.
    const [first, second] = CHAT_CHAIN;
    withEnv({ ...KEYS, [first!.keyEnv]: "x", [second!.keyEnv]: "y" }, () => {
      const expected = first!.dailyTokens + second!.dailyTokens;
      assert(dayCapacityTokens() === expected, `expected ${expected}, got ${dayCapacityTokens()}`);
    });
  });

  await check("an env override recalibrates a vendor's budget without a deploy", () => {
    withEnv({ ...KEYS, GROQ_API_KEY: "x", LOKI_GROQ_DAILY_TOKENS: "12345" }, () => {
      assert(dayCapacityTokens() === 12_345, `got ${dayCapacityTokens()}`);
    });
    withEnv({ ...KEYS, GROQ_API_KEY: "x", LOKI_GROQ_DAILY_TOKENS: "nonsense" }, () => {
      const groq = CHAT_CHAIN.find((p) => p.id === "groq")!;
      assert(
        dayCapacityTokens() === groq.dailyTokens,
        "a junk override must fall back, not zero the budget",
      );
    });
  });

  // ── the gate ───────────────────────────────────────────────────────────────
  const plenty = () => 1_000_000;
  // Free accounts, read without a database: the default plan read opens a pool
  // that keeps this process alive where CI has a real Postgres.
  const noPlan = async () => 0;

  await check("a user well inside their share is admitted", async () => {
    const v = await checkAiBudget("u1", NOON, {
      planAllowance: noPlan,
      timeZone: "Europe/Zurich",
      capacity: plenty,
      readUsage: async () => ({ userSpentTokens: 0, activeUsers: 1, userTurns: 0 }),
    });
    assert(v.allowed, "refused a turn with a million tokens available");
  });

  await check(
    "A LEDGER ERROR ADMITS THE TURN — rationing must never become an outage",
    async () => {
      const v = await checkAiBudget("u1", NOON, {
        planAllowance: noPlan,
        timeZone: "Europe/Zurich",
        capacity: plenty,
        readUsage: async () => {
          throw new Error("connection refused");
        },
      });
      assert(v.allowed, "a database error refused the turn — this is the fail-closed trap");
    },
  );

  await check("a capacity of zero refuses, and says there is nothing to draw on", async () => {
    const v = await checkAiBudget("u1", NOON, {
      planAllowance: noPlan,
      timeZone: "Europe/Zurich",
      capacity: () => 0,
      readUsage: async () => ({ userSpentTokens: 0, activeUsers: 1, userTurns: 0 }),
    });
    assert(!v.allowed, "admitted a turn with no capacity");
    assert(
      !v.allowed && /no ai provider/i.test(v.message),
      `unhelpful message: ${!v.allowed && v.message}`,
    );
  });

  await check("'paced' offers a retry and explains WHY there is a wait", async () => {
    // Expressed in units of ESTIMATED_TURN_TOKENS so recalibrating that constant
    // cannot silently move this case into the OTHER refusal — which is exactly
    // what happened when the estimate was corrected from 10k to 20k.
    //
    // Two users share 8·EST → 4·EST each. At noon the pace unlocks 0.75 of it,
    // i.e. 3·EST. Spending 2.5·EST leaves a request of 3.5·EST: past the
    // unlocked allowance, still inside the day's share. That is `paced`.
    const v = await checkAiBudget("u1", NOON, {
      planAllowance: noPlan,
      timeZone: "Europe/Zurich",
      capacity: () => 8 * ESTIMATED_TURN_TOKENS,
      readUsage: async () => ({
        userSpentTokens: 2.5 * ESTIMATED_TURN_TOKENS,
        activeUsers: 2,
        userTurns: 3,
      }),
    });
    assert(!v.allowed, "expected a refusal");
    if (v.allowed) return;
    assert(typeof v.retryAfterSeconds === "number", "paced refusal must carry a retry");
    // "so everyone gets a turn" is the difference between a reason a person
    // accepts and an unexplained refusal that reads as breakage.
    assert(/through the day/i.test(v.message), `message does not explain the wait: ${v.message}`);
    assert(/the next one is ready at \d\d:\d\d/.test(v.message), `no clock time: ${v.message}`);
    assert(!/share|budget|tops up/i.test(v.message), `jargon in the refusal: ${v.message}`);
  });

  await check("'share-spent' promises NO retry — waiting cannot help today", async () => {
    // Same 8·EST day, same two users — but this one has already spent their
    // whole 4·EST share, so no amount of waiting unlocks another turn today.
    const v = await checkAiBudget("u1", NOON, {
      planAllowance: noPlan,
      timeZone: "Europe/Zurich",
      capacity: () => 8 * ESTIMATED_TURN_TOKENS,
      readUsage: async () => ({
        userSpentTokens: 4 * ESTIMATED_TURN_TOKENS,
        activeUsers: 2,
        userTurns: 3,
      }),
    });
    assert(!v.allowed, "expected a refusal");
    if (v.allowed) return;
    assert(v.retryAfterSeconds === undefined, "offered a retry that cannot succeed today");
    assert(
      /full again tomorrow at 02:00 \(midnight UTC\)/.test(v.message),
      `message must say when it starts over, on the person's clock: ${v.message}`,
    );
  });

  await check("a newcomer among many users still gets their first turn", async () => {
    // Four users sharing 16·EST → 4·EST each, against a turn costing EST. The
    // share covers it several times over, so admission must not depend on the
    // time of day: at one minute past midnight the pace has unlocked almost
    // nothing, and it is exactly then that a new user forms their first
    // impression. The one-turn floor is what carries this case.
    for (const at of ["2026-08-15T00:01:00Z", "2026-08-15T12:00:00Z", "2026-08-15T23:00:00Z"]) {
      const v = await checkAiBudget("newcomer", new Date(at), {
        planAllowance: noPlan,
        timeZone: "Europe/Zurich",
        capacity: () => 16 * ESTIMATED_TURN_TOKENS,
        readUsage: async () => ({ userSpentTokens: 0, activeUsers: 4, userTurns: 0 }),
      });
      assert(v.allowed, `newcomer refused at ${at}`);
    }
  });

  await check("cheap answers are admitted while room is left for one more", async () => {
    // Two users on an 8·EST day → 4·EST (80k) each; noon unlocks 60k. 52k spent
    // over 26 answers of 2k: the old flat 20k reserve wanted 72k and refused,
    // though eight more such answers fit. The reserve is now the person's own
    // cost (+25%, floored at 5k), so this turn goes through.
    const v = await checkAiBudget("u1", NOON, {
      planAllowance: noPlan,
      timeZone: "Europe/Zurich",
      capacity: () => 8 * ESTIMATED_TURN_TOKENS,
      readUsage: async () => ({ userSpentTokens: 52_000, activeUsers: 2, userTurns: 26 }),
    });
    assert(v.allowed, `refused with room left: ${!v.allowed && v.message}`);
  });

  await check("the admission estimate is conservative, not free", () => {
    // Admitting on a zero estimate would let any number of turns through before
    // the first one is booked.
    assert(ESTIMATED_TURN_TOKENS > 0, "a zero estimate admits everything");
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
