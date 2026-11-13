import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

/**
 * The OrangeCat model door (/api/orangecat/model): a person's OrangeCat bots
 * answered on a key the person keeps in Loki. Pinned here, without a database
 * or a network: what the door refuses before it looks anyone up, what a
 * request may be, that the person's own endpoint is never shareable, and that
 * the vendor call sends the key only as a bearer header and never returns it.
 *
 * Run: npx tsx scripts/test/orangecat-model-door.ts
 */
async function main(): Promise<void> {
  console.log("orangecat model door:");
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";

  const { POST } = await import("../../src/app/api/orangecat/model/route");
  const { NextRequest } = await import("next/server");
  const { OrangecatModelRequest, completeAtVendor, shareableVendor, vendorSentence } =
    await import("../../src/lib/orangecat-model");

  const secret = "model-door-test-secret-at-least-32-characters";
  const sign = (raw: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const request = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return new NextRequest("https://loki.orangecat.ch/api/orangecat/model", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-orangecat-signature": signature } : {}),
      },
      body: raw,
    });
  };
  const base = {
    actorId: "00000000-0000-4000-8000-000000000000",
    issuedAt: new Date().toISOString(),
  };
  const ask = {
    do: "complete",
    vendor: "xai",
    messages: [{ role: "user", content: "Say hello." }],
  };
  const body = { ...base, request: ask };
  const original = process.env.ORANGECAT_WEBHOOK_SECRET;

  try {
    delete process.env.ORANGECAT_WEBHOOK_SECRET;
    assert.equal((await POST(request(body, sign(JSON.stringify(body))))).status, 503);
    console.log("  ✓ unconfigured fails closed (503)");

    process.env.ORANGECAT_WEBHOOK_SECRET = secret;
    assert.equal((await POST(request(body, "sha256=deadbeef"))).status, 401);
    assert.equal((await POST(request(body))).status, 401);
    console.log("  ✓ bad or missing signature (401)");

    const stale = { ...body, issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
    const staleRes = await POST(request(stale, sign(JSON.stringify(stale))));
    assert.equal(staleRes.status, 401);
    assert.equal((await staleRes.json()).error, "stale request");
    console.log("  ✓ a signed but stale request is refused (replay)");

    for (const bad of [
      base,
      { ...base, request: { do: "complete", vendor: "custom", messages: ask.messages } },
      { ...base, request: { ...ask, vendor: "nope" } },
      { ...base, request: { ...ask, messages: [] } },
      { ...base, request: { ...ask, tools: [{ type: "function" }] } },
      {
        ...base,
        request: { ...ask, tools: [{ type: "function", function: { name: "bad name!" } }] },
      },
      { ...base, request: { ...ask, response_format: { type: "json_object" } } },
      { ...base, request: { ...ask, model: "../etc/passwd model" } },
      { ...base, request: { ...ask, maxTokens: 1_000_000 } },
      { ...base, request: { ...ask, messages: [{ role: "tool", content: "x" }] } },
      { ...base, request: { ...ask, messages: [{ role: "developer", content: "x" }] } },
      { ...base, request: { do: "share", vendor: "xai" } },
      { ...base, request: { do: "reveal", vendor: "xai" } },
    ]) {
      assert.equal((await POST(request(bad, sign(JSON.stringify(bad))))).status, 400);
    }
    const huge = new NextRequest("https://loki.orangecat.ch/api/orangecat/model", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "50000000" },
      body: "{}",
    });
    assert.equal((await POST(huge)).status, 413);
    console.log(
      "  ✓ only a chat completion, a list or a switch; never custom, no vendor fields (400)",
    );
  } finally {
    if (original === undefined) delete process.env.ORANGECAT_WEBHOOK_SECRET;
    else process.env.ORANGECAT_WEBHOOK_SECRET = original;
  }

  assert.equal(shareableVendor("custom"), null);
  assert.equal(shareableVendor("made-up"), null);
  assert.equal(shareableVendor("xai")?.baseUrl.startsWith("https://"), true);
  console.log("  ✓ the person's own endpoint is never shareable");

  for (const good of [
    { do: "keys" },
    { do: "share", vendor: "xai", on: true },
    { do: "models", vendor: "openai" },
    {
      ...ask,
      model: "grok-4",
      temperature: 0.3,
      maxTokens: 800,
      messages: [
        { role: "system", content: "Be brief." },
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
    },
    {
      ...ask,
      toolChoice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "walk_site",
            description: "Walk a live site.",
            parameters: { type: "object", properties: { url: { type: "string" } } },
          },
        },
      ],
      messages: [
        { role: "user", content: "Check orangecat.ch" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "walk_site", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "3 pages, no problems." },
      ],
    },
  ]) {
    assert.equal(OrangecatModelRequest.safeParse(good).success, true, JSON.stringify(good));
  }
  console.log("  ✓ the four requests parse, tool turns included");

  const key = "xai-SECRETSECRETSECRETSECRETSECRET1234";
  let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
  const vendor = (status: number, json: unknown) =>
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = {
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      };
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
  const input = {
    baseUrl: "https://api.x.ai/v1",
    apiKey: key,
    model: "grok-4",
    messages: [{ role: "user" as const, content: "Say hello." }],
    maxTokens: 50,
  };

  const ok = await completeAtVendor(
    input,
    vendor(200, {
      model: "grok-4-0709",
      choices: [{ message: { content: "Hello." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
    }),
  );
  assert.deepEqual(ok, {
    ok: true,
    content: "Hello.",
    toolCalls: [],
    model: "grok-4-0709",
    finishReason: "stop",
    usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
  });
  assert.equal(seen!.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(seen!.auth, `Bearer ${key}`);
  assert.deepEqual(Object.keys(seen!.body).sort(), ["max_tokens", "messages", "model"]);
  assert.equal(JSON.stringify(ok).includes(key), false);
  console.log(
    "  ✓ a completion: key as bearer only, only chat fields sent, nothing of the key back",
  );

  const refused = await completeAtVendor(
    input,
    vendor(401, { error: { message: `Incorrect API key provided: ${key}. Check it.` } }),
  );
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 401);
  assert.equal(JSON.stringify(refused).includes(key), false);
  assert.equal(vendorSentence({ error: "Out of credit" }), "Out of credit");
  console.log("  ✓ a vendor refusal keeps its status and never echoes the key");

  const tool = { type: "function" as const, function: { name: "walk_site" } };
  const asked = await completeAtVendor(
    { ...input, tools: [tool] },
    vendor(200, {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_9",
                type: "function",
                function: { name: "walk_site", arguments: '{"url":"https://orangecat.ch"}' },
              },
              { id: "x", type: "function", function: { name: "rm -rf /" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    }),
  );
  assert.equal(asked.ok, true);
  assert.deepEqual(asked.ok && asked.toolCalls, [
    { id: "call_9", name: "walk_site", arguments: '{"url":"https://orangecat.ch"}' },
  ]);
  assert.deepEqual(seen!.body.tools, [tool]);
  assert.equal(seen!.body.tool_choice, "auto");
  console.log(
    "  ✓ a function the model asks for comes back to be run by the caller, native format",
  );

  const empty = await completeAtVendor(input, vendor(200, { choices: [{ message: {} }] }));
  assert.equal(empty.ok, false);
  const down = await completeAtVendor(input, (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch);
  assert.deepEqual(down, { ok: false, status: null, detail: "The provider could not be reached." });
  console.log("  ✓ no words, or no answer, is a plain failure and never throws");

  console.log("orangecat model door: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
