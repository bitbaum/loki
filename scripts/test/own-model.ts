/**
 * A user's own model: their key goes to their vendor, and only there.
 *
 * THE PROPERTIES THIS PINS
 * ------------------------
 * Loki's chat can run on a key the user brought (Settings → AI). The walker
 * that makes the call looks a link's key up BY NAME, so the whole safety of
 * the feature rests on one rule: a user's link reads its key only from the
 * per-call env ai-kit's byokChain returns, and a server link reads only
 * `process.env`. Break it either way and one of two things happens:
 *
 *   • a deployment that happens to set BYOK_API_KEY answers every user's turn
 *     on the operator's account, or
 *   • a user's key rides along on a server link to a vendor they never chose.
 *
 * The test drives the REAL walker (`callModelWithTools`) with a fake fetch and
 * reads the request it actually sends.
 *
 * Run: npx tsx scripts/test/own-model.ts
 */
import assert from "node:assert/strict";
import { byokChain } from "@bitbaum/ai-kit/byok";
import { callModelWithTools } from "@/lib/agent/llm";
import { OWN_MODEL_KEY_ENV, isOwnModelLink, keyForLink, ownModelFrom } from "@/lib/own-model";
import type { ChatLink } from "@/config/chat-models";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const USER_KEY = "sk-ant-test-not-a-real-key-1234";
const config = { vendor: "anthropic" as const, apiKey: USER_KEY, model: "claude-opus-5.5" };

async function main() {
  await check("the key name here is the one ai-kit's byokChain actually uses", () => {
    const { chain, env } = byokChain(config);
    assert.equal(chain[0]!.provider.keyEnv, OWN_MODEL_KEY_ENV);
    assert.equal((env as Record<string, string>)[OWN_MODEL_KEY_ENV], USER_KEY);
  });

  await check("a user's link never falls back to a key the server happens to hold", () => {
    const own = ownModelFrom(config);
    const link = own.chain[0]!;
    process.env[OWN_MODEL_KEY_ENV] = "server-set-this-by-accident";
    try {
      assert.equal(keyForLink(link, own), USER_KEY);
      assert.equal(
        keyForLink(link, undefined),
        undefined,
        "no per-call env → no key, never process.env",
      );
    } finally {
      delete process.env[OWN_MODEL_KEY_ENV];
    }
  });

  await check("a server link never takes a key a user supplied", () => {
    const serverLink = {
      provider: {
        id: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        keyEnv: "GROQ_API_KEY",
        models: ["m"],
      },
      model: "m",
    } as unknown as ChatLink;
    const hostile = { env: { GROQ_API_KEY: "user-injected" } };
    process.env.GROQ_API_KEY = "the-server-groq-key";
    try {
      assert.equal(isOwnModelLink(serverLink), false);
      assert.equal(keyForLink(serverLink, hostile), "the-server-groq-key");
    } finally {
      delete process.env.GROQ_API_KEY;
    }
  });

  await check(
    "a chat turn on the user's model sends ONE request, to their vendor, with their key and model",
    async () => {
      const own = ownModelFrom(config);
      const sent: { url: string; auth: string | undefined; model: unknown; allHeaders: string }[] =
        [];
      const realFetch = globalThis.fetch;
      process.env.GROQ_API_KEY = "the-server-groq-key";
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sent.push({
          url: String(url),
          auth: headers.Authorization,
          model: JSON.parse(String(init?.body ?? "{}")).model,
          allHeaders: JSON.stringify(headers),
        });
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Hello from your model." } }],
            usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      try {
        const turn = await callModelWithTools({
          messages: [{ role: "user", content: "hi" }],
          tools: [],
          validToolNames: [],
          feature: "own-model-test",
          own,
        });
        assert.equal(sent.length, 1, `expected one request, got ${sent.length}`);
        assert.equal(sent[0]!.url, "https://api.anthropic.com/v1/chat/completions");
        assert.equal(sent[0]!.auth, `Bearer ${USER_KEY}`);
        assert.equal(sent[0]!.model, "claude-opus-5.5");
        assert.ok(!sent[0]!.allHeaders.includes("the-server-groq-key"), "a server key rode along");
        assert.match(JSON.stringify(turn), /Hello from your model/);
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.GROQ_API_KEY;
      }
    },
  );

  await check("OpenRouter gets its attribution headers; a direct lab does not", () => {
    assert.ok(
      ownModelFrom({ ...config, vendor: "openrouter", model: "anthropic/claude-opus-5.5" })
        .extraHeaders,
    );
    assert.equal(ownModelFrom(config).extraHeaders, undefined);
  });

  await check("the label names the vendor and model, never the key", () => {
    const label = ownModelFrom(config).label;
    assert.match(label, /Anthropic · claude-opus-5\.5/);
    assert.ok(!label.includes(USER_KEY));
  });

  console.log(`\nown-model: ${passed} passed`);
}

void main();
