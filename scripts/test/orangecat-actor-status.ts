import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

/**
 * OrangeCat's read of one person's Loki projects (/api/orangecat/actor-status).
 *
 * Two halves: the pure shaping (what crosses to OrangeCat, and nothing else),
 * and the refusals that must not need a database — unconfigured, bad
 * signature, stale request, bad body. The linked/unlinked answer needs a real
 * account and is not asserted here.
 *
 * Run: npx tsx scripts/test/orangecat-actor-status.ts
 */
async function main(): Promise<void> {
  console.log("orangecat actor-status:");

  // Importing the route pulls in `@/db`, which wants a URL at module load. A
  // valid URL pointing at nothing: every refusal below returns before a query,
  // and one that didn't would fail loudly instead of reaching a real DB.
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";

  const { shapeActorStatus, isFreshIssuedAt, ACTOR_STATUS_MAX_PROJECTS } =
    await import("../../src/lib/integrations/orangecat-actor-status");

  // ── shaping ────────────────────────────────────────────────────────────────

  const base = {
    projects: [
      { id: "p1", name: "Ceramics", liveUrl: "https://ceramics.example", entityProjectId: "e1" },
      { id: "p2", name: "Blog", liveUrl: null, entityProjectId: "e2" },
      { id: "p3", name: "Quiet", liveUrl: "javascript:alert(1)", entityProjectId: null },
    ],
    states: [
      {
        projectKey: "ceramics",
        agentRunning: false,
        sessionStatus: "ready",
        sessionBlockReason: "awaiting_user",
        promptQueue: [1, 2],
        currentPromptLabel: "Add shop page",
      },
      {
        projectKey: "BLOG",
        agentRunning: true,
        sessionStatus: "working",
        sessionBlockReason: null,
        promptQueue: [],
        currentPromptLabel: null,
      },
    ],
    outcomes: new Map([
      ["Ceramics", ["success", "error", "success", "partial", "hang", "timeout"]],
    ]),
    feedback: [{ projectId: "e1", newCount: 3, openCount: 4 }],
    links: [{ projectId: "p1", entityType: "product", entityId: "oc-1" }],
  };

  const [ceramics, blog, quiet] = shapeActorStatus(base);

  assert.equal(ceramics.status, "blocked", "a block reason wins over everything");
  assert.equal(ceramics.blockReason, "awaiting_user");
  assert.equal(ceramics.queueDepth, 2);
  assert.equal(ceramics.currentWork, "Add shop page");
  assert.deepEqual(ceramics.feedback, { new: 3, open: 4 }, "feedback matched by entity id");
  assert.deepEqual(ceramics.orangecat, [{ entityType: "product", entityId: "oc-1" }]);
  assert.equal(ceramics.recentOutcomes.length, 5, "outcomes capped at 5");
  assert.match(ceramics.lokiUrl, /^https:\/\/.+\/projects\/p1$/);
  console.log("  ✓ blocked project, feedback by entity id, links, outcome cap");

  assert.equal(blog.status, "working", "state lookup is case-insensitive");
  assert.deepEqual(blog.feedback, { new: 0, open: 0 });
  assert.equal(blog.liveUrl, null);
  console.log("  ✓ working project, no feedback, not deployed");

  assert.equal(quiet.status, "idle", "no state row = idle");
  assert.equal(quiet.liveUrl, null, "a non-http live URL never crosses the boundary");
  console.log("  ✓ idle project; unsafe URL dropped");

  const allowed = new Set([
    "id",
    "name",
    "lokiUrl",
    "liveUrl",
    "status",
    "blockReason",
    "queueDepth",
    "currentWork",
    "recentOutcomes",
    "feedback",
    "orangecat",
  ]);
  for (const key of Object.keys(ceramics)) {
    assert.ok(allowed.has(key), `unexpected field crosses to OrangeCat: ${key}`);
  }
  console.log("  ✓ only the contract's fields are sent");

  const many = shapeActorStatus({
    ...base,
    projects: Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      liveUrl: null,
      entityProjectId: null,
    })),
  });
  assert.equal(many.length, ACTOR_STATUS_MAX_PROJECTS);
  console.log("  ✓ capped at 25 projects");

  // The cap keeps what needs the person, not the first 25 in list order: an
  // account with 37 projects never showed OrangeCat its own `orangecat` project.
  const crowd = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`,
    name: `C${i}`,
    liveUrl: null,
    entityProjectId: null,
  }));
  const ordered = shapeActorStatus({
    ...base,
    projects: crowd,
    states: [
      {
        projectKey: "c29",
        agentRunning: false,
        sessionStatus: "ready",
        sessionBlockReason: "awaiting_user",
        promptQueue: [],
        currentPromptLabel: null,
      },
    ],
    outcomes: new Map(),
    feedback: [],
    links: [{ projectId: "c28", entityType: "project", entityId: "oc-9" }],
  });
  assert.equal(ordered.length, ACTOR_STATUS_MAX_PROJECTS);
  assert.equal(ordered[0].id, "c29", "a project waiting on its owner leads, even from position 30");
  assert.ok(
    ordered.some((p) => p.id === "c28"),
    "a project linked to OrangeCat survives the cap",
  );
  assert.equal(ordered[2].id, "c0", "the rest keep their list order");
  console.log("  ✓ ordered by attention before the cap");

  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.ok(isFreshIssuedAt("2026-09-24T11:57:00Z", now));
  assert.ok(isFreshIssuedAt("2026-09-24T12:02:00Z", now), "small clock skew ahead is fine");
  assert.ok(!isFreshIssuedAt("2026-09-24T11:50:00Z", now));
  assert.ok(!isFreshIssuedAt("not a date", now));
  console.log("  ✓ freshness window");

  // ── refusals (no database) ─────────────────────────────────────────────────

  const { POST } = await import("../../src/app/api/orangecat/actor-status/route");
  const { NextRequest } = await import("next/server");
  const secret = "actor-status-test-secret-at-least-32-characters";
  const sign = (raw: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const request = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return new NextRequest("https://loki.orangecat.ch/api/orangecat/actor-status", {
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
    console.log("  ✓ a correctly signed but stale request is refused (replay)");

    const bad = { actorId: "not-a-uuid", issuedAt: fresh.issuedAt };
    assert.equal((await POST(request(bad, sign(JSON.stringify(bad))))).status, 400);
    console.log("  ✓ bad body (400)");
  } finally {
    if (original === undefined) delete process.env.ORANGECAT_WEBHOOK_SECRET;
    else process.env.ORANGECAT_WEBHOOK_SECRET = original;
  }

  console.log("orangecat actor-status: all passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
