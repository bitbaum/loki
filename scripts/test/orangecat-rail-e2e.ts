/**
 * The OrangeCat rail's browser doors, exercised on the live site.
 *
 * Run on the box by .github/workflows/orangecat-rail-check.yml: it signs real
 * requests with the rail's own secret (ORANGECAT_WEBHOOK_SECRET, read from
 * the app's env on the box and never printed), as the operator's linked
 * OrangeCat actor, and drives what a Cat Bot drives:
 *
 *   1. site-walk: a page that must pass, and one that must fail with its reason
 *      and a picture address that serves a JPEG
 *   2. browser: open, a numbered element list, click, a typed search, back,
 *      a password field refused, a private address refused, close
 *   3. the doors' own edges: unsigned is refused, a stale request is refused
 *
 * Prints PASS/FAIL lines, addresses and counts only. Exit 1 on any FAIL.
 *
 * Run: ORANGECAT_WEBHOOK_SECRET=… DATABASE_URL=… npx tsx scripts/test/orangecat-rail-e2e.ts
 */
import { createHmac, randomUUID } from "node:crypto";

const BASE = (process.env.BASE ?? "https://loki.orangecat.ch").replace(/\/$/, "");
const SECRET = process.env.ORANGECAT_WEBHOOK_SECRET ?? "";
const TARGET = (process.env.E2E_TARGET ?? "https://orangecat.ch").replace(/\/$/, "");

let failed = 0;
function record(name: string, ok: boolean, evidence: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${evidence}`);
}

type Json = Record<string, unknown>;

async function signed(path: string, payload: Json, opts: { sign?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.sign === false ? {} : { "x-orangecat-signature": sig }),
    },
    body,
    signal: AbortSignal.timeout(170_000),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json };
}

type View = {
  url: string;
  title: string;
  text: string;
  elements: { n: number; kind: string; name: string }[];
  screenshotUrl?: string;
};

async function operatorActor(): Promise<string | null> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const rows = await sql`
      SELECT orangecat_actor_id AS actor FROM users
      WHERE orangecat_actor_id IS NOT NULL
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    return (rows[0] as { actor?: string } | undefined)?.actor ?? null;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function isJpeg(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return `${res.status} ${res.headers.get("content-type")} ${Math.round(bytes.length / 1024)} KB${jpeg ? "" : " NOT A JPEG"}`;
}

async function main() {
  if (SECRET.length < 32) {
    console.log("down: the rail's secret is not set on this box");
    process.exit(1);
  }
  const actorId = await operatorActor();
  if (!actorId) {
    console.log("down: no Loki account is linked to an OrangeCat actor on this box");
    process.exit(1);
  }
  const now = () => new Date().toISOString();

  // ── the doors' own edges ────────────────────────────────────────────────
  const unsigned = await signed(
    "/api/orangecat/browser",
    { actorId, issuedAt: now(), botId: randomUUID(), action: { do: "look" } },
    { sign: false },
  );
  record("an unsigned step is refused", unsigned.status === 401, `HTTP ${unsigned.status}`);
  const stale = await signed("/api/orangecat/site-walk", {
    actorId,
    issuedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    steps: [{ url: `${TARGET}/` }],
  });
  record("a request an hour old is refused", stale.status === 401, `HTTP ${stale.status}`);
  const stranger = await signed("/api/orangecat/site-walk", {
    actorId: randomUUID(),
    issuedAt: now(),
    steps: [{ url: `${TARGET}/` }],
  });
  record(
    "an actor with no Loki account walks nothing",
    stranger.status === 409,
    `HTTP ${stranger.status}`,
  );

  // ── 1. the walk ─────────────────────────────────────────────────────────
  const walk = await signed("/api/orangecat/site-walk", {
    actorId,
    issuedAt: now(),
    steps: [
      { url: `${TARGET}/`, expect: ["OrangeCat"] },
      { url: `${TARGET}/discover`, expect: ["words that are not on this page"] },
    ],
  });
  const steps = (walk.json.steps ?? []) as {
    ok: boolean;
    title: string | null;
    problems: string[];
    screenshotUrl?: string;
  }[];
  record(
    "walk: a page that is fine passes",
    walk.status === 200 && steps[0]?.ok === true,
    `HTTP ${walk.status}; "${steps[0]?.title ?? "?"}"; problems: ${JSON.stringify(steps[0]?.problems ?? null)}`,
  );
  const bad = steps[1];
  record(
    "walk: a page missing its words fails, with the sentence",
    bad?.ok === false && (bad.problems ?? []).some((p) => p.includes("does not show")),
    JSON.stringify(bad?.problems ?? null).slice(0, 200),
  );
  record(
    "walk: the failed page's picture is served as a JPEG",
    Boolean(bad?.screenshotUrl) && !(await isJpeg(bad!.screenshotUrl!)).includes("NOT"),
    bad?.screenshotUrl ? await isJpeg(bad.screenshotUrl) : "no picture address",
  );

  // ── 2. a bot's own browser ──────────────────────────────────────────────
  const botId = randomUUID();
  const step = async (action: Json, screenshot = false) => {
    const r = await signed("/api/orangecat/browser", {
      actorId,
      issuedAt: now(),
      botId,
      action,
      screenshot,
    });
    return {
      status: r.status,
      done: r.json.done === true,
      reason: String(r.json.reason ?? ""),
      detail: String(r.json.detail ?? ""),
      view: r.json.view as View | undefined,
    };
  };

  const none = await step({ do: "click", n: 1 });
  record(
    "browser: a click with no page open is said, not guessed",
    !none.done && /no page open/.test(none.detail),
    none.detail.slice(0, 120),
  );

  const opened = await step({ do: "open", url: `${TARGET}/` }, true);
  const ov = opened.view;
  record(
    "browser: a page opens, with its elements numbered",
    opened.done && (ov?.elements.length ?? 0) >= 5 && Boolean(ov?.title),
    `"${ov?.title ?? "?"}" ${ov?.url ?? ""}; ${ov?.elements.length ?? 0} elements; first: ${ov?.elements
      .slice(0, 5)
      .map((e) => `${e.n}:${e.kind}:${e.name.slice(0, 18)}`)
      .join(" | ")}`,
  );
  record(
    "browser: the picture of the page is served as a JPEG",
    Boolean(ov?.screenshotUrl) && !(await isJpeg(ov!.screenshotUrl!)).includes("NOT"),
    ov?.screenshotUrl ? await isJpeg(ov.screenshotUrl) : "no picture address",
  );

  const clicked = await step({ do: "click", label: "Discover" });
  record(
    "browser: a click by its words goes where the link goes",
    clicked.done && /\/discover/.test(clicked.view?.url ?? ""),
    `${clicked.view?.url ?? clicked.detail}`,
  );
  // A field, never the "Open search" button that also says "search": the first
  // run on the live site (2026-11-13) picked the button and failed on its own mistake.
  const search = clicked.view?.elements.find(
    (e) => e.kind.startsWith("field:") && (e.kind === "field:search" || /search/i.test(e.name)),
  );
  if (search) {
    const typed = await step({ do: "type", n: search.n, text: "bike", submit: true });
    record(
      "browser: typing into a numbered field and pressing Enter works",
      typed.done,
      `${typed.done ? "" : `${typed.detail} `}field ${search.n} (${search.kind}); now ${typed.view?.url ?? "?"}`.slice(
        0,
        200,
      ),
    );
  } else {
    record(
      "browser: typing into a numbered field and pressing Enter works",
      false,
      "no search field on /discover",
    );
  }
  const back = await step({ do: "back" });
  record("browser: back goes back", back.done, `${back.view?.url ?? back.detail}`);

  const auth = await step({ do: "open", url: `${TARGET}/auth` });
  const pass = auth.view?.elements.find((e) => e.kind === "field:password");
  if (pass) {
    const refused = await step({ do: "type", n: pass.n, text: "not-a-real-password" });
    record(
      "browser: a password field is never typed into",
      !refused.done && refused.reason === "stopped",
      refused.detail.slice(0, 140),
    );
  } else {
    record(
      "browser: a password field is never typed into",
      false,
      "no password field found on /auth",
    );
  }

  const inside = await step({ do: "open", url: "http://127.0.0.1:3000/" });
  record(
    "browser: the box's own network is out of reach",
    !inside.done && !/200/.test(inside.detail),
    inside.detail.slice(0, 140),
  );
  const meta = await step({ do: "open", url: "http://169.254.169.254/latest/meta-data/" });
  record("browser: so is the cloud's metadata address", !meta.done, meta.detail.slice(0, 140));

  const closed = await step({ do: "close" });
  record("browser: it closes", closed.done, `HTTP ${closed.status}`);

  console.log(`\n${failed === 0 ? "all passed" : `${failed} FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(`down: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
  process.exit(1);
});
