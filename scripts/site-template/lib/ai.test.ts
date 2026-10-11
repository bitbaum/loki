import { describe, expect, it } from "vitest";
import { ask, freeAvailable, freeLinks, MAX_PROMPT } from "./ai";

/** A vendor that answers every request with `reply`, OpenAI-shaped. */
function vendor(reply: string, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String(input));
    void init;
    return new Response(
      JSON.stringify({ id: "x", choices: [{ message: { role: "assistant", content: reply } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("free chain", () => {
  it("is empty — and the feature says so — without any vendor key", () => {
    expect(freeLinks({})).toEqual([]);
    expect(freeAvailable({})).toBe(false);
  });

  it("switches on with any one vendor key", () => {
    expect(freeAvailable({ GROQ_API_KEY: "k" })).toBe(true);
  });
});

describe("ask", () => {
  it("refuses an empty or oversized prompt before calling anyone", async () => {
    const seen: string[] = [];
    const env = { GROQ_API_KEY: "k" };
    expect(await ask("  ", { env, fetchImpl: vendor("x", seen) })).toEqual({
      ok: false,
      error: "empty_prompt",
    });
    expect(await ask("x".repeat(MAX_PROMPT + 1), { env, fetchImpl: vendor("x", seen) })).toEqual({
      ok: false,
      error: "too_long",
    });
    expect(seen).toEqual([]);
  });

  it("says not_configured rather than failing when no key exists", async () => {
    expect(await ask("hello", { env: {} })).toEqual({ ok: false, error: "not_configured" });
  });

  it("answers through the free chain", async () => {
    const outcome = await ask("hello", { env: { GROQ_API_KEY: "k" }, fetchImpl: vendor("hi") });
    expect(outcome).toMatchObject({ ok: true, text: "hi", ownModel: false });
  });

  it("serves a person's own key only to their own model, at their vendor", async () => {
    const seen: string[] = [];
    const outcome = await ask("hello", {
      env: { GROQ_API_KEY: "server-key" },
      ownModel: { vendor: "openrouter", apiKey: "sk-or-own", model: "some/model" },
      fetchImpl: vendor("mine", seen),
    });
    expect(outcome).toMatchObject({ ok: true, text: "mine", ownModel: true });
    expect(seen.every((url) => url.includes("openrouter.ai"))).toBe(true);
  });
});
