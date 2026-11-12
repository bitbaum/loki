import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

/**
 * The OrangeCat feedback door (/api/orangecat/feedback) refuses before it
 * reaches a database: unconfigured, unsigned, stale, or a body that is
 * neither a filing nor a status read. What a filing IS lives in
 * lib/feedback/agent-filing and is pinned by agent-feedback-ingest.ts.
 *
 * Run: npx tsx scripts/test/orangecat-feedback-door.ts
 */
async function main(): Promise<void> {
  console.log("orangecat feedback door:");
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";

  const { POST } = await import("../../src/app/api/orangecat/feedback/route");
  const { NextRequest } = await import("next/server");
  const secret = "feedback-door-test-secret-at-least-32-characters";
  const sign = (raw: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const request = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return new NextRequest("https://loki.orangecat.ch/api/orangecat/feedback", {
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
  const filing = {
    ...base,
    project: "orangecat",
    suggestion: "Test finding from a bot. Harmless, please ignore.",
    agentName: "Thinker",
    idempotencyKey: "thinker-test-0001",
  };
  const read = { ...base, feedbackId: "11111111-1111-4111-8111-111111111111" };
  const original = process.env.ORANGECAT_WEBHOOK_SECRET;

  try {
    delete process.env.ORANGECAT_WEBHOOK_SECRET;
    assert.equal((await POST(request(filing, sign(JSON.stringify(filing))))).status, 503);
    console.log("  ✓ unconfigured fails closed (503)");

    process.env.ORANGECAT_WEBHOOK_SECRET = secret;
    assert.equal((await POST(request(filing, "sha256=deadbeef"))).status, 401);
    assert.equal((await POST(request(read))).status, 401);
    console.log("  ✓ bad or missing signature (401)");

    for (const body of [filing, read]) {
      const stale = { ...body, issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
      const res = await POST(request(stale, sign(JSON.stringify(stale))));
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, "stale request");
    }
    console.log("  ✓ a signed but stale filing or read is refused (replay)");

    for (const bad of [
      base,
      { ...filing, agentName: "" },
      { ...filing, suggestion: "x".repeat(2001) },
      { ...filing, idempotencyKey: "short" },
      { ...filing, screenshots: ["data:image/png;base64,AAAA"] },
      { ...read, feedbackId: "nope" },
      { ...read, project: "orangecat" },
    ]) {
      assert.equal((await POST(request(bad, sign(JSON.stringify(bad))))).status, 400);
    }
    console.log("  ✓ neither a filing nor a read, or anything but words (400)");
  } finally {
    if (original === undefined) delete process.env.ORANGECAT_WEBHOOK_SECRET;
    else process.env.ORANGECAT_WEBHOOK_SECRET = original;
  }

  console.log("orangecat feedback door: all passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
