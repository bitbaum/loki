/**
 * The ask door refuses before it reaches a database or a model.
 *
 * `POST /api/orangecat/ask` lets another service run a model turn AS a Loki
 * user. So the refusals that must hold with nothing else configured are the
 * ones under test: no secret → 503, no signature → 401, a body that is not a
 * question → 400. None of them may touch the database, and the route must stay
 * read-only — a bot's question is never a way to dispatch or approve.
 *
 * Runs in `pnpm run verify` (globbed by scripts/test-unit.ts). No database, no
 * network, no server.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ROUTE = join(REPO, "src/app/api/orangecat/ask/route.ts");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("orangecat ask door:");

  // See orangecat-site-door.ts: importing the route loads `@/db`, which wants
  // a connection string at module load; nothing below reaches a query.
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";
  const secret = "shared-orangecat-webhook-secret-at-least-32ch";

  const { POST, ASK_MAX_CHARS } = await import("../../src/app/api/orangecat/ask/route");

  function request(body: unknown, signature?: string): Request {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signature !== undefined) headers["x-orangecat-signature"] = signature;
    return new Request("https://loki.orangecat.ch/api/orangecat/ask", {
      method: "POST",
      headers,
      body: raw,
    });
  }
  const sign = (body: unknown) =>
    "sha256=" + createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");

  const good = { actorId: "11111111-1111-4111-8111-111111111111", question: "What is live?" };

  delete process.env.ORANGECAT_WEBHOOK_SECRET;
  const unconfigured = await POST(request(good, sign(good)) as never);
  check("no secret configured → 503, before anything else", unconfigured.status === 503);

  process.env.ORANGECAT_WEBHOOK_SECRET = secret;
  const unsigned = await POST(request(good) as never);
  check("no signature → 401", unsigned.status === 401);

  const tampered = await POST(request({ ...good, question: "other" }, sign(good)) as never);
  check("signature over another body → 401", tampered.status === 401);

  const empty = { ...good, question: "   " };
  check(
    "a blank question → 400",
    (await POST(request(empty, sign(empty)) as never)).status === 400,
  );

  const long = { ...good, question: "x".repeat(ASK_MAX_CHARS + 1) };
  check(
    "a question over the ceiling → 400",
    (await POST(request(long, sign(long)) as never)).status === 400,
  );

  const notActor = { ...good, actorId: "not-a-uuid" };
  check(
    "an actor id that is not a uuid → 400",
    (await POST(request(notActor, sign(notActor)) as never)).status === 400,
  );

  // ── read-only, by source ────────────────────────────────────────────────────
  const src = readFileSync(ROUTE, "utf8");
  check("the turn is read-only", /readOnly:\s*true/.test(src), "askLoki(…, { readOnly: true })");
  check(
    "the turn runs as the linked user, never a default",
    src.includes("getUserByOrangeCatActorId"),
  );
  check("the front door is the shared one", src.includes("readSignedOrangeCatBody"));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
