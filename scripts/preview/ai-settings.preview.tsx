import * as React from "react";
import { createRoot } from "react-dom/client";
import { AiBudgetSettings } from "@/components/settings/AiBudgetSettings";
import { OwnModelSettings } from "@/components/settings/OwnModelSettings";
import { BuildEngineChoice } from "@/components/settings/BuildEngineChoice";
import { AiQuotaSettings } from "@/components/settings/AiQuotaSettings";

// Settings → AI, every card, with the answers the four routes gave the owner
// on 2026-10-21 (the screenshots that started the redesign), so the page is
// looked at before it is shipped. `?empty=1` renders the account with no key
// and no plan; `?plan=1` a paid account.
const q = new URLSearchParams(window.location.search);
const empty = q.get("empty") === "1";
const onPlan = q.get("plan") === "1";

const ownKeys = empty
  ? []
  : [
      {
        kind: "own-key",
        vendor: "xai",
        label: "xAI",
        model: "grok-4.7",
        tokensToday: 46_825,
        callsToday: 3,
        tokens30d: 577_646,
        calls30d: 36,
        line: "Today 46,825 tokens in 3 answers · 30 days 577,646 tokens in 36 answers.",
        left: {
          line: "On your xAI account: 7,200 of 7,200 requests left.",
          short: "",
          spent: false,
        },
        consequence:
          "No limit from Loki — xAI bills you directly — set a monthly spending limit there and it protects you whatever Loki does.",
        billingUrl: "https://console.x.ai",
      },
    ];

const budget = {
  headline: "",
  freePool: {
    kind: "free-pool",
    state: "ok",
    shareTokens: 750_000,
    allowanceTokens: 400_000,
    spentTokens: 19_042,
    turnsToday: 7,
    tokensPerAnswer: 2_720,
    measured: true,
    answersNow: 134,
    answersToday: 267,
    usedLevel: 0.025,
    unlocksIn: null,
    nextAt: null,
    fullAgainAt: "tomorrow at 02:00",
    short: "267 left",
    resetsIn: "in 17 hours",
    activeUsers: 1,
    models: ["groq/openai/gpt-oss-120b", "gemini/gemini-2.5-flash", "openrouter/qwen/qwen3-235b"],
    line: "267 free answers left today (134 right now, the rest free up through the day) · full again tomorrow at 02:00.",
    consequence: empty
      ? "Add your own model key and there is no daily limit on your chats."
      : "Auto uses your own keys first. Choosing a free model uses this daily count; if your key fails, Loki asks before switching to free.",
  },
  ownKeys,
  models: [
    {
      id: "groq/openai/gpt-oss-120b",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      state: "known",
      note: null,
      left: "267 left today",
    },
    {
      id: "gemini/gemini-2.5-flash",
      provider: "gemini",
      model: "gemini-2.5-flash",
      state: "unknown",
      note: null,
      left: "267 left today",
    },
    {
      id: "openrouter/qwen/qwen3-235b",
      provider: "openrouter",
      model: "qwen/qwen3-235b",
      state: "known",
      note: "Running low — about 3 answers left, refills in 40 minutes",
      left: "Running low",
    },
  ],
  meaning: {
    pace: "At today's pace your daily count lasts the whole day.",
    week: {
      tokens: 426_286,
      turns: 180,
      days: 7,
      line: "Last 7 days: 180 free answers, 426,286 tokens, on 7 days.",
    },
    memory: { turns: 20, charsPerTurn: 4000, line: "" },
    explain: [
      {
        title: "Answers, not tokens",
        body: "A token is a fragment of a word, and one answer costs a few thousand of them.",
      },
      {
        title: "Why there is a daily count",
        body: "The free models are free because their makers give this server a fixed amount each day.",
      },
    ],
    actions: [],
  },
  resetsAt: "2026-10-23T00:00:00.000Z",
  plan: onPlan
    ? {
        name: "Personal",
        answersMonthly: 1000,
        answersLeft: 812,
        line: "Your Personal plan: 812 of 1,000 answers left this month, past the daily free share.",
      }
    : null,
};

const models = empty
  ? []
  : [
      {
        vendor: "xai",
        model: "grok-4.7",
        keyHint: "…VWhN",
        verifiedAt: "2026-10-10T08:00:00.000Z",
        baseUrl: null,
        label: null,
        buildEngine: "Grok",
        forBuilding: false,
      },
    ];

const routing = {
  stance: "best",
  picks: [
    {
      tier: "economy",
      vendor: "xai",
      model: "grok-build-0.1",
      name: "Grok Build 0.1",
      reason: "best value among cheap models",
      chosenBy: "auto",
    },
    {
      tier: "standard",
      vendor: "xai",
      model: "grok-4.7",
      name: "Grok 4.7",
      reason: "best value at or above the median",
      chosenBy: "auto",
    },
    {
      tier: "frontier",
      vendor: "xai",
      model: "grok-4.7",
      name: "Grok 4.7",
      reason: "the smartest your keys reach",
      chosenBy: "auto",
    },
  ],
  candidates: [
    {
      vendor: "xai",
      model: "grok-build-0.1",
      name: "Grok Build 0.1",
      index: 27,
      outPerM: 2,
      tier: "economy",
    },
    { vendor: "xai", model: "grok-4.7", name: "Grok 4.7", index: 46, outPerM: 6, tier: "standard" },
    { vendor: "xai", model: "grok-4.6", name: "Grok 4.6", index: 44, outPerM: 6, tier: "standard" },
  ],
  keys: [{ vendor: "xai", model: "grok-4.7", label: null }],
  catalogReadAt: Date.now() - 20 * 60_000,
};

const engine = {
  choice: "own",
  lokiAvailable: true,
  welcomeBuilds: 3,
  planBuildsMonthly: onPlan ? 10 : 0,
  welcomeLeft: 3,
  planLeft: onPlan ? 10 : null,
  exhausted: null,
};

const quota = {
  summary: "About 999 more answers · 11 not measured yet (of 12 configured).",
  providers: [
    {
      provider: "groq",
      model: "openai/gpt-oss-120b",
      state: "known",
      answers: 999,
      unitNoun: "answers",
      detail: "999 of 1,000 requests today",
      refills: "in 9 hours",
      consequence: "then it moves to gemini",
      level: 0.999,
      urgent: false,
      observedAt: Date.now(),
    },
    {
      provider: "gemini",
      model: "gemini-2.5-flash",
      state: "unknown",
      answers: null,
      detail:
        "served 7 calls today (19,042 tokens) — this vendor publishes no limits, so there is nothing left to measure",
      refills: null,
      consequence: "this is the last link — after it, answers wait for the reset",
      level: null,
      urgent: false,
      observedAt: null,
    },
  ],
  configured: [],
  spend: [
    { feature: "widget-advise", tokens: 19_042, calls: 7 },
    { feature: "proposal-extract", tokens: 520, calls: 1 },
  ],
  spendTotal: 19_562,
};

const ok = (body: unknown) =>
  new Response(JSON.stringify({ ok: true, ...(body as object) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

window.fetch = async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/ai/budget")) return ok(budget);
  if (url.includes("/api/settings/model/routing")) return ok(routing);
  if (url.includes("/api/settings/build-engine")) return ok(engine);
  if (url.includes("/api/settings/model"))
    return ok({
      available: true,
      models,
      usage: [],
      billing: { xai: { billingUrl: "https://console.x.ai", limit: "a monthly spending limit" } },
    });
  if (url.includes("/api/ai/quota")) return ok(quota);
  return new Response("{}", { status: 404 });
};

function App() {
  return (
    <div className="app-page mx-auto max-w-4xl">
      <h1 className="ui-page-title mb-6">Settings · AI</h1>
      <div className="space-y-6">
        <AiBudgetSettings />
        <OwnModelSettings cloudBuilder />
        <BuildEngineChoice />
        <AiQuotaSettings />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
