/**
 * Every app on the server, every AI vendor, one picture (lib/ai/fleet-usage).
 *
 * The cases that matter are the ones a dashboard gets wrong: a log that could
 * not be read drawn as "nothing used", a vendor nobody called drawn as full or
 * empty, a paid vendor sitting among free ones, and a refusal shown as a code.
 *
 * Run: npx tsx scripts/test/fleet-usage.ts
 */
import assert from "node:assert/strict";
import type { UsageEvent } from "@bitbaum/ai-kit";
import { appLabel, featureLabel, fleetUsageView, problemWords } from "@/lib/ai/fleet-usage";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
};

const now = Date.UTC(2026, 10, 13, 12, 0, 0);
const e = (
  minAgo: number,
  app: string,
  provider: string,
  outcome: UsageEvent["outcome"],
  more: Partial<UsageEvent> = {},
): UsageEvent => ({
  t: now - minAgo * 60_000,
  app,
  provider,
  model: `${provider}-m`,
  outcome,
  paid: provider === "google" || provider === "xai",
  byok: false,
  ...more,
});
const keys = new Set(["GROQ_API_KEY", "OPENROUTER_API_KEY"]);

check("a log that could not be read is not 'nothing used'", () => {
  const v = fleetUsageView({ events: null, keysSet: keys, now });
  assert.equal(v.readable, false);
  assert.match(v.headline, /could not be read/);
  assert.equal(v.vendors.find((x) => x.id === "groq")?.line, "Not readable");
});

check("a vendor with a key and no calls is 'not called today', neither full nor empty", () => {
  const v = fleetUsageView({ events: [], keysSet: keys, now });
  const groq = v.vendors.find((x) => x.id === "groq");
  assert.equal(groq?.state, "not-called");
  assert.match(groq?.consequence ?? "", /no reading/);
  assert.match(v.headline, /No app has made an AI call/);
});

check("a vendor with no key and no calls is left out; Google is not listed once retired", () => {
  const v = fleetUsageView({ events: [], keysSet: keys, now });
  assert.equal(
    v.vendors.some((x) => x.id === "google"),
    false,
  );
  assert.equal(
    v.vendors.some((x) => x.id === "xai"),
    false,
  );
});

check("who used a vendor is named per app, busiest first", () => {
  const v = fleetUsageView({
    events: [
      e(30, "ORANGECAT", "groq", "served"),
      e(20, "ORANGECAT", "groq", "served"),
      e(10, "LOKI", "groq", "served"),
    ],
    keysSet: keys,
    now,
  });
  const groq = v.vendors.find((x) => x.id === "groq");
  assert.deepEqual(
    groq?.apps.map((a) => a.app),
    ["Orangecat", "Loki"],
  );
  assert.equal(groq?.state, "answering");
  assert.match(
    v.headline,
    /2 apps made 3 answered calls today\. None went to a vendor that bills\./,
  );
});

check(
  "a refusal after the last answer reads as not answering, in words, with what happens next",
  () => {
    const v = fleetUsageView({
      events: [
        e(50, "HEIDI", "groq", "served"),
        e(5, "HEIDI", "groq", "failed", { status: 429, kind: "daily" }),
      ],
      keysSet: keys,
      now,
    });
    const groq = v.vendors.find((x) => x.id === "groq");
    assert.equal(groq?.state, "refusing");
    assert.match(groq?.problem ?? "", /today's free allowance is used up \(5 min ago\)/);
    assert.match(groq?.consequence ?? "", /move on to the next vendor/);
    assert.ok(!/429|daily/.test(`${groq?.problem} ${groq?.stateLabel}`), "no code, no flag");
    assert.match(v.headline, /Groq is not answering right now/);
  },
);

check("an answer after a refusal reads as answering again", () => {
  const v = fleetUsageView({
    events: [e(50, "A", "groq", "failed", { status: 429 }), e(5, "A", "groq", "served")],
    keysSet: keys,
    now,
  });
  assert.equal(v.vendors.find((x) => x.id === "groq")?.state, "answering");
});

check(
  "a paid vendor that answered is said to bill, with the count, and reaches the headline",
  () => {
    const v = fleetUsageView({
      events: [
        e(9, "HEIDI", "google", "served"),
        e(8, "HEIDI", "google", "served"),
        e(7, "LOKI", "groq", "served"),
      ],
      keysSet: new Set([...keys, "GEMINI_API_KEY"]),
      now,
    });
    const google = v.vendors.find((x) => x.id === "google");
    assert.equal(google?.paid, true);
    assert.match(google?.consequence ?? "", /bills per call\. 2 calls were answered today/);
    assert.match(v.headline, /2 calls went to a vendor that bills\./);
    assert.deepEqual(
      google?.apps.map((a) => a.app),
      ["Heidi"],
    );
  },
);

check("a paid vendor stopped by the spend rules says nothing was spent", () => {
  const v = fleetUsageView({
    events: [e(3, "SOLON", "google", "refused", { reason: "paid-not-opted-in" })],
    keysSet: new Set([...keys, "GEMINI_API_KEY"]),
    now,
  });
  const google = v.vendors.find((x) => x.id === "google");
  assert.match(google?.problem ?? "", /paid AI is switched off for that app/);
  assert.match(google?.consequence ?? "", /Nothing is being spent here/);
});

check("calls with no key left on the server say the next one will not be made", () => {
  const v = fleetUsageView({ events: [e(3, "HEIDI", "google", "served")], keysSet: keys, now });
  const google = v.vendors.find((x) => x.id === "google");
  assert.equal(google?.keySet, false);
  assert.match(google?.consequence ?? "", /no longer holds its key/);
});

check("a person's own key is counted apart, never against the server's vendors", () => {
  const v = fleetUsageView({
    events: [{ ...e(3, "LOKI", "xai", "served"), byok: true }],
    keysSet: keys,
    now,
  });
  assert.match(v.ownKeyLine ?? "", /1 call today used a person's own key/);
  assert.equal(
    v.vendors.some((x) => x.id === "xai"),
    false,
  );
  assert.equal(v.apps.length, 0);
});

check("per app: which vendors answered it", () => {
  const v = fleetUsageView({
    events: [
      e(3, "ORANGECAT", "groq", "served"),
      e(2, "ORANGECAT", "openrouter", "failed", { status: 503 }),
    ],
    keysSet: keys,
    now,
  });
  assert.deepEqual(v.apps[0].vendors.map((p) => p.label).sort(), ["Groq", "OpenRouter"]);
  assert.match(v.apps[0].line, /1 answered · 1 failed/);
});

check("words for every way a link does not answer; an app id reads as a name", () => {
  assert.match(problemWords({ at: 0, outcome: "failed", status: 401 }), /rejected the key/);
  assert.match(problemWords({ at: 0, outcome: "failed", status: 502 }), /error on its side/);
  assert.match(
    problemWords({ at: 0, outcome: "refused", reason: "fleet-cap" }),
    /server's daily paid allowance/,
  );
  assert.equal(appLabel("SBB_FUNDBUERO"), "Sbb fundbuero");
});

check("per app: what the calls were for, when the app said (2026-11-14)", () => {
  const v = fleetUsageView({
    events: [
      e(9, "SOLON", "groq", "served", { feature: "law-translate" }),
      e(8, "SOLON", "groq", "failed", { feature: "law-translate", status: 429 }),
      e(7, "SOLON", "groq", "served", { feature: "law-ask" }),
      e(6, "LOKI", "groq", "served"),
    ],
    keysSet: keys,
    now,
  });
  const solon = v.apps.find((a) => a.app === "Solon");
  assert.equal(solon?.usedFor, "law translate: 1 answered · 1 failed · law ask: 1 answered");
  assert.equal(
    v.apps.find((a) => a.app === "Loki")?.usedFor,
    null,
    "an app that names nothing says nothing",
  );
  assert.equal(featureLabel("statistics_explain"), "statistics explain");
});

console.log(`fleet-usage: ${passed} checks passed`);
