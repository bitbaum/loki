import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

/**
 * OrangeCat's read of one person's agent sessions (/api/orangecat/sessions).
 *
 * Two halves, like orangecat-actor-status: the pure shaping (what crosses, and
 * how much of it), and the refusals that need no database: unconfigured, bad
 * signature, stale request, bad body.
 *
 * Run: npx tsx scripts/test/orangecat-sessions.ts
 */
async function main(): Promise<void> {
  console.log("orangecat sessions:");
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";

  const {
    shapeSessionRow,
    orderSessions,
    shapeTranscriptItems,
    oneLine,
    SESSIONS_MAX_ITEMS,
    SESSIONS_ITEM_CHARS,
  } = await import("../../src/lib/integrations/orangecat-sessions");

  // ── rows ───────────────────────────────────────────────────────────────────

  const presence = { cloud: true, local: false, any: true };
  const run = {
    id: "11111111-1111-4111-8111-111111111111",
    state: "working",
    label: "Working",
    reason: null,
    task: "\n  Fix the header\nand the footer",
    track: "The agent is working on it.",
    prUrl: "https://github.com/acme/site/pull/7",
    lastProgressAt: "2026-11-12T03:00:00.000Z",
  };

  const working = shapeSessionRow({
    project: "site",
    builderPref: "cloud",
    presence,
    run,
    transcriptAt: Date.parse("2026-11-12T03:05:00Z"),
  });
  assert.equal(working.state, "working");
  assert.equal(working.builder, "cloud");
  assert.equal(working.online, true);
  assert.equal(working.task, "Fix the header", "the task is the first line asked");
  assert.equal(
    working.lastActivityAt,
    "2026-11-12T03:05:00.000Z",
    "a transcript frame is the freshest sign of life",
  );
  assert.equal(working.runId, run.id);
  assert.match(working.statusUrl ?? "", /\/api\/orchestration\/runs\/11111111-/);
  assert.equal(working.prUrl, run.prUrl);
  console.log("  ✓ a working session: canonical state, one-line task, run and PR");

  const local = shapeSessionRow({
    project: "site",
    builderPref: "local",
    presence,
    run: { ...run, prUrl: "javascript:alert(1)" },
    transcriptAt: null,
  });
  assert.equal(local.online, false, "online means the project's own builder");
  assert.equal(local.lastActivityAt, run.lastProgressAt, "no frame: the runner's last progress");
  assert.equal(local.prUrl, null, "a non-http URL never crosses");
  console.log("  ✓ online follows the preferred builder; unsafe URL dropped");

  const idle = shapeSessionRow({
    project: "quiet",
    builderPref: null,
    presence,
    run: null,
    transcriptAt: null,
  });
  assert.equal(idle.state, "idle");
  assert.equal(idle.label, "Idle");
  assert.equal(idle.runId, null);
  assert.equal(idle.statusUrl, null);
  assert.equal(idle.online, true, "no preference: any builder counts");
  console.log("  ✓ no run on record is idle");

  const odd = shapeSessionRow({
    project: "odd",
    builderPref: "moon",
    presence,
    run: { ...run, state: "sideways" },
    transcriptAt: null,
  });
  assert.equal(odd.state, "idle", "a state outside the canonical six is never forwarded");
  assert.equal(odd.builder, null);
  console.log("  ✓ unknown state and builder are not passed through");

  const ordered = orderSessions([
    idle,
    working,
    { ...working, project: "stuck", state: "needs_you" },
    { ...idle, project: "quiet2" },
  ]);
  assert.deepEqual(
    ordered.map((r) => r.project),
    ["stuck", "site", "quiet", "quiet2"],
  );
  console.log("  ✓ what needs the person leads, then work in flight, then list order");

  assert.equal(oneLine("   \n\n"), null);
  assert.equal((oneLine("x".repeat(500)) ?? "").length, 200);

  // ── transcript ─────────────────────────────────────────────────────────────

  const items = [
    { id: "1", at: "2026-11-12T03:00:00Z", kind: "user" as const, text: "git status" },
    {
      id: "2",
      at: "2026-11-12T03:00:01Z",
      kind: "tool" as const,
      name: "Bash",
      summary: "git status --short --branch",
      status: "done" as const,
      result: "## main...origin/main",
    },
    { id: "3", at: null, kind: "assistant" as const, text: "y".repeat(5000) },
    { id: "4", at: null, kind: "assistant" as const, text: "   " },
  ];
  const shaped = shapeTranscriptItems(items, 10);
  assert.equal(shaped.length, 3, "an empty message is dropped");
  assert.equal(shaped[1].kind, "tool");
  assert.equal(shaped[1].text, "Bash: git status --short --branch\n## main...origin/main");
  assert.equal(shaped[2].text.length, SESSIONS_ITEM_CHARS, "long text is clipped");
  assert.equal(shapeTranscriptItems(items, 2).length, 1, "the LAST n items, then empties dropped");
  const many = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    at: null,
    kind: "user" as const,
    text: `m${i}`,
  }));
  assert.equal(shapeTranscriptItems(many, 999).length, SESSIONS_MAX_ITEMS);
  assert.equal(shapeTranscriptItems(many, 999).at(-1)?.text, "m99");
  console.log("  ✓ transcript: last n, clipped, tools as one row, capped at 40");

  // ── refusals (no database) ─────────────────────────────────────────────────

  const { POST } = await import("../../src/app/api/orangecat/sessions/route");
  const { NextRequest } = await import("next/server");
  const secret = "sessions-test-secret-at-least-32-characters-long";
  const sign = (raw: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const request = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return new NextRequest("https://loki.orangecat.ch/api/orangecat/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-orangecat-signature": signature } : {}),
      },
      body: raw,
    });
  };
  const fresh = {
    actorId: "00000000-0000-4000-8000-000000000000",
    issuedAt: new Date().toISOString(),
  };
  const original = process.env.ORANGECAT_WEBHOOK_SECRET;

  try {
    delete process.env.ORANGECAT_WEBHOOK_SECRET;
    assert.equal((await POST(request(fresh, sign(JSON.stringify(fresh))))).status, 503);
    console.log("  ✓ unconfigured fails closed (503)");

    process.env.ORANGECAT_WEBHOOK_SECRET = secret;
    assert.equal((await POST(request(fresh, "sha256=deadbeef"))).status, 401);
    assert.equal((await POST(request(fresh))).status, 401);
    console.log("  ✓ bad or missing signature (401)");

    const stale = { ...fresh, issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() };
    const staleRes = await POST(request(stale, sign(JSON.stringify(stale))));
    assert.equal(staleRes.status, 401);
    assert.equal((await staleRes.json()).error, "stale request");
    console.log("  ✓ a signed but stale request is refused (replay)");

    for (const bad of [
      { ...fresh, actorId: "not-a-uuid" },
      { ...fresh, runId: "nope" },
      { ...fresh, items: 41 },
      { ...fresh, project: "" },
    ]) {
      assert.equal((await POST(request(bad, sign(JSON.stringify(bad))))).status, 400);
    }
    console.log("  ✓ a bad body is refused (400)");
  } finally {
    if (original === undefined) delete process.env.ORANGECAT_WEBHOOK_SECRET;
    else process.env.ORANGECAT_WEBHOOK_SECRET = original;
  }

  console.log("orangecat sessions: all passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
