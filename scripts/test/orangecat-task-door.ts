import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

/**
 * The task door (/api/orangecat/task): what it refuses with nothing else
 * configured, and the words a caller gets back.
 *
 * The door starts agents in a person's repositories, so the refusals that
 * must hold before any database is reached are under test: no secret, no
 * signature, a body that names a builder that does not exist. The sentences
 * a person reads (a busy project, where a run is followed) are pure and
 * pinned here too.
 *
 * Run: npx tsx scripts/test/orangecat-task-door.ts
 */
async function main(): Promise<void> {
  console.log("orangecat task door:");
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";

  const { busySentence, runStatusUrl } = await import("../../src/lib/multi-project-dispatch");

  assert.equal(
    busySentence(["orangecat"]),
    "orangecat is already working on a run. Nothing was sent. Wait for it to finish, or send again saying either to queue it behind the open run or to start a separate session for it.",
  );
  assert.match(busySentence(["loki", "solon"]), /^loki, solon are already working on a run\./);
  console.log("  ✓ a busy project is named, and the person is told nothing was sent");

  assert.match(
    runStatusUrl("11111111-1111-4111-8111-111111111111"),
    /^https:\/\/.+\/api\/orchestration\/runs\/11111111-1111-4111-8111-111111111111$/,
  );
  console.log("  ✓ a run's status address is the run route");

  const { POST } = await import("../../src/app/api/orangecat/task/route");
  const { NextRequest } = await import("next/server");
  const secret = "task-door-test-secret-at-least-32-characters-long";
  const sign = (raw: string) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const request = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return new NextRequest("https://loki.orangecat.ch/api/orangecat/task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-orangecat-signature": signature } : {}),
      },
      body: raw,
    });
  };
  const good = {
    actorId: "00000000-0000-4000-8000-000000000000",
    task: "git status --short --branch",
    projects: ["orangecat"],
    builderChannel: "cloud",
    queueIfBusy: false,
  };
  const original = process.env.ORANGECAT_WEBHOOK_SECRET;

  try {
    delete process.env.ORANGECAT_WEBHOOK_SECRET;
    assert.equal((await POST(request(good, sign(JSON.stringify(good))))).status, 503);
    console.log("  ✓ unconfigured fails closed (503)");

    process.env.ORANGECAT_WEBHOOK_SECRET = secret;
    assert.equal((await POST(request(good, "sha256=deadbeef"))).status, 401);
    assert.equal((await POST(request(good))).status, 401);
    console.log("  ✓ bad or missing signature (401)");

    for (const bad of [
      { ...good, builderChannel: "moon" },
      { ...good, queueIfBusy: "yes" },
      { ...good, separateSession: "yes" },
      { ...good, projects: [] },
      { ...good, task: "  " },
    ]) {
      assert.equal((await POST(request(bad, sign(JSON.stringify(bad))))).status, 400);
    }
    console.log("  ✓ an unknown builder, a non-boolean queue flag, no project, no task (400)");
  } finally {
    if (original === undefined) delete process.env.ORANGECAT_WEBHOOK_SECRET;
    else process.env.ORANGECAT_WEBHOOK_SECRET = original;
  }

  console.log("orangecat task door: all passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
