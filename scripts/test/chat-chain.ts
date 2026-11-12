/**
 * Inline tests for the chat model chain (config/chat-models.ts).
 *
 * The chain is the difference between "one vendor's free tier runs dry and Loki
 * is down" and "Loki keeps answering on someone else's". Its whole value is in
 * the ORDER and the FILTERING, both of which are silent when wrong: a chain that
 * drops every link still returns a plausible-looking empty array, and a chain
 * that ignores a key still "works" right up until the vendor it forgot was the
 * only one configured.
 *
 * Run: npm run test:chat-chain
 */
import {
  CHAT_CHAIN,
  usableChatChain,
  chainFrom,
  providerModels,
  type ChatProvider,
} from "@/config/chat-models";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

/** Run `fn` with exactly these env vars set, restoring whatever was there. */
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

// Every key and model override the chain reads, from the chain itself: a list
// written by hand missed GEMINI_API_KEY once Gemini joined the chain, so a
// machine that held one failed "unkeyed provider leaked into the chain".
const unset = (names: (string | undefined)[]): Record<string, undefined> =>
  Object.fromEntries(names.filter((k): k is string => !!k).map((k) => [k, undefined]));
const KEYS = unset(CHAT_CHAIN.map((p) => p.keyEnv));
const NO_OVERRIDES = unset(CHAT_CHAIN.map((p) => p.modelsEnv));
const groq = CHAT_CHAIN.find((p) => p.id === "groq") as ChatProvider;
const openrouter = CHAT_CHAIN.find((p) => p.id === "openrouter") as ChatProvider;

check("the shipped chain spans MORE THAN ONE vendor", () => {
  // A "chain" within a single vendor is the bug this file exists to fix: every
  // link would share that vendor's daily budget, so all of them die together.
  const vendors = new Set(CHAT_CHAIN.map((p) => p.id));
  assert(
    vendors.size >= 2,
    `only ${vendors.size} vendor(s) configured: ${[...vendors].join(", ")}`,
  );
});

check("every provider declares a key env and at least one model", () => {
  for (const p of CHAT_CHAIN) {
    assert(Boolean(p.keyEnv), `${p.id} has no keyEnv`);
    assert(p.models.length > 0, `${p.id} ships no models`);
    assert(p.baseUrl.startsWith("https://"), `${p.id} baseUrl is not https: ${p.baseUrl}`);
  }
});

check("a provider with no key is skipped silently, not thrown on", () => {
  withEnv({ ...KEYS, ...NO_OVERRIDES, GROQ_API_KEY: "x" }, () => {
    const chain = usableChatChain();
    assert(chain.length > 0, "keyed provider produced no links");
    assert(
      chain.every((l) => l.provider.id === "groq"),
      "unkeyed provider leaked into the chain",
    );
  });
});

check("no keys at all yields an empty chain rather than a broken link", () => {
  withEnv({ ...KEYS, ...NO_OVERRIDES }, () => {
    assert(usableChatChain().length === 0, "produced links with no keys configured");
  });
});

check("links are provider-ordered, and each carries its own provider", () => {
  withEnv({ ...KEYS, ...NO_OVERRIDES, GROQ_API_KEY: "x", OPENROUTER_API_KEY: "y" }, () => {
    const chain = usableChatChain();
    const firstOpenRouter = chain.findIndex((l) => l.provider.id === "openrouter");
    const lastGroq = chain.map((l) => l.provider.id).lastIndexOf("groq");
    assert(lastGroq < firstOpenRouter, "providers are interleaved — order must follow CHAT_CHAIN");
    assert(
      chain.every((l) => providerModels(l.provider).includes(l.model)),
      "a link carries a model its own provider does not offer",
    );
  });
});

// ── env override: routing around a rotted model without a deploy ─────────────
check("an env override replaces a provider's models AT CALL TIME", () => {
  withEnv(
    { ...KEYS, ...NO_OVERRIDES, GROQ_API_KEY: "x", LOKI_GROQ_MODELS: "only-this-one" },
    () => {
      // Read after the env was set — a value frozen at import would fail here,
      // and would need a redeploy to route around a dead model.
      assert(providerModels(groq).join() === "only-this-one", `got ${providerModels(groq).join()}`);
      assert(
        usableChatChain().every((l) => l.model === "only-this-one"),
        "override not applied to the chain",
      );
    },
  );
});

check("an override accepts commas, spaces, or both", () => {
  withEnv({ LOKI_OPENROUTER_MODELS: "a/one:free,  b/two:free   c/three:free" }, () => {
    assert(
      providerModels(openrouter).join("|") === "a/one:free|b/two:free|c/three:free",
      "bad split",
    );
  });
});

check("a blank override falls back to the shipped models, not to nothing", () => {
  withEnv({ LOKI_GROQ_MODELS: "   " }, () => {
    assert(
      providerModels(groq).length === groq.models.length,
      "whitespace override emptied the provider",
    );
  });
});

// ── chainFrom: a pin must not reintroduce the single point of failure ────────
const FAKE: ChatLinkFixture = [
  { provider: groq, model: "m1" },
  { provider: groq, model: "m2" },
  { provider: openrouter, model: "m3" },
];
type ChatLinkFixture = Array<{ provider: ChatProvider; model: string }>;

check("no pin means the whole chain", () => {
  assert(chainFrom(undefined, FAKE).length === 3, "dropped links with no pin");
  assert(chainFrom("  ", FAKE).length === 3, "blank pin should behave as no pin");
});

check("a pinned model STARTS the chain and keeps everything after it", () => {
  const out = chainFrom("m2", FAKE);
  assert(out.length === 2, `expected 2 links, got ${out.length}`);
  assert(out[0]!.model === "m2" && out[1]!.model === "m3", "pin did not start the chain");
});

check("pinning the last link still leaves a chain of one, not zero", () => {
  assert(
    chainFrom("m3", FAKE)
      .map((l) => l.model)
      .join() === "m3",
    "lost the pinned link",
  );
});

check("an UNKNOWN model is tried first, then falls through to the real chain", () => {
  // The escape hatch ("run Loki on this model") must not become the single
  // point of failure this file exists to remove.
  const out = chainFrom("brand-new-model", FAKE);
  assert(out[0]!.model === "brand-new-model", "unknown model was not tried first");
  assert(out.length === 4, `expected fallthrough to the full chain, got ${out.length}`);
});

check("an unknown model with NO usable chain yields nothing to call", () => {
  assert(chainFrom("anything", []).length === 0, "invented a link with no provider configured");
});

console.log(`\n${passed} passed`);
