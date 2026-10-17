/**
 * The free pool is as big as the vendors say, never smaller than configured.
 *
 * Live, 2026-10-17: the platform keys served 357k tokens against a configured
 * 250k — Google 96k of its "50k" — while people were told the pool was nearly
 * gone. These pin the three witnesses (stated token ceiling, stated request
 * ceiling, served today), that the configured figure is a floor, and that an
 * operator's explicit override wins.
 *
 * Pure: no database.
 */
import {
  DEFAULT_TOKENS_PER_CALL,
  observedDayCapacity,
  providerCapacity,
  type CapacityProvider,
  type CeilingReading,
} from "@/lib/ai/observed-capacity";

let passed = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (!cond)
    throw new Error(`✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const groq: CapacityProvider = {
  id: "groq",
  models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  configured: 100_000,
  overridden: false,
};
const openrouter: CapacityProvider = {
  id: "openrouter",
  models: ["a:free", "b:free"],
  configured: 100_000,
  overridden: false,
};
const reading = (over: Partial<CeilingReading>): CeilingReading => ({
  provider: "groq",
  model: "openai/gpt-oss-120b",
  scope: "tokens",
  window: "day",
  quotaLimit: 200_000,
  source: "refusal",
  ...over,
});

check("nothing heard: the configured figure", providerCapacity(groq, [], null).tokens === 100_000);

const perModel = providerCapacity(
  groq,
  [
    reading({}),
    reading({ model: "openai/gpt-oss-20b", quotaLimit: 200_000 }),
    reading({ scope: "requests", quotaLimit: 1_000, source: "headers" }),
  ],
  null,
);
check(
  "per-model token ceilings add up; a looser request ceiling does not bind",
  perModel.tokens === 400_000 && perModel.from === "token ceiling",
  perModel,
);

check(
  "a model outside the chain does not add to it",
  providerCapacity(groq, [reading({ model: "whisper-large-v3-turbo" })], null).tokens === 100_000,
);

const requests = providerCapacity(
  openrouter,
  [
    reading({ provider: "openrouter", model: "a:free", scope: "requests", quotaLimit: 1_000 }),
    // The same account-wide allowance, reported under another model: counted once.
    reading({ provider: "openrouter", model: "b:free", scope: "requests", quotaLimit: 1_000 }),
  ],
  { tokens: 40_000, calls: 20 },
);
check(
  "a request ceiling is counted once per vendor, at what a call costs there today",
  requests.tokens === 1_000 * 2_000 && requests.from === "request ceiling",
  requests,
);

const unmeasured = providerCapacity(
  openrouter,
  [reading({ provider: "openrouter", model: "a:free", scope: "requests", quotaLimit: 50 })],
  { tokens: 9_000, calls: 2 },
);
check(
  "too few calls to measure: the default per-call cost, and the floor still holds",
  unmeasured.tokens === Math.max(100_000, 50 * DEFAULT_TOKENS_PER_CALL),
  unmeasured,
);

const tight = providerCapacity(
  groq,
  [reading({}), reading({ scope: "requests", quotaLimit: 30, source: "headers" })],
  { tokens: 150_000, calls: 30 },
);
check(
  "when the request ceiling is the tighter one, it binds",
  tight.tokens === 150_000 && tight.from !== "token ceiling",
  tight,
);

const google: CapacityProvider = {
  id: "google",
  models: ["g"],
  configured: 50_000,
  overridden: false,
};
const served = providerCapacity(google, [], { tokens: 96_206, calls: 14 });
check(
  "a vendor that publishes no limits holds at least what it served today",
  served.tokens === 96_206 && served.from === "served today",
  served,
);

check(
  "a preflight skip is not a ceiling",
  providerCapacity(groq, [reading({ source: "preflight", quotaLimit: 5_000_000 })], null).tokens ===
    100_000,
);
check(
  "a per-minute ceiling is not a day's",
  providerCapacity(groq, [reading({ window: "minute", quotaLimit: 5_000_000 })], null).tokens ===
    100_000,
);

const operator = providerCapacity(
  { ...groq, configured: 20_000, overridden: true },
  [reading({})],
  { tokens: 90_000, calls: 30 },
);
check(
  "an operator's explicit figure wins outright",
  operator.tokens === 20_000 && operator.from === "operator",
  operator,
);

const total = observedDayCapacity(
  [groq, google],
  [reading({}), reading({ model: "openai/gpt-oss-20b" })],
  [{ provider: "google", tokens: 96_206, calls: 14 }],
);
check("the day's capacity is the sum across vendors", total.tokens === 400_000 + 96_206, total);

console.log(`\nobserved-capacity: ${passed} checks passed`);
