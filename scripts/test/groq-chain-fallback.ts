/**
 * The direct text path falls through vendors — and never lies about who answered.
 * Run: npx tsx scripts/test/groq-chain-fallback.ts
 *
 * On 2026-08-18 Groq retired `llama-3.3-70b-versatile`. Loki survived because it
 * walked a cross-vendor chain; the sixteen DIRECT callers of callGroqText had
 * one vendor and no fallback, so seven features were dark for eight days. This
 * pins the fix.
 *
 * Two properties matter equally, and the second is the subtle one:
 *   1. a failing link must be followed by the next VENDOR (not the next model at
 *      the same vendor — a daily token cap kills every model behind one key)
 *   2. the completion must report the model that ACTUALLY answered, because
 *      callers persist that as provenance and a fallback would otherwise write
 *      a record naming a model that never ran.
 */
import assert from "node:assert/strict";

process.env.GROQ_API_KEY = "test-groq-key";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";

import { readFileSync } from "node:fs";
import { callTextDetailed, callGroqText, GROQ_FAST_MODEL } from "../../src/lib/groq";
import { usableChatChain } from "../../src/config/chat-models";

type Handler = (
  url: string,
  body: { model: string },
) => { status: number; content?: string; text?: string };

const realFetch = globalThis.fetch;
const calls: { url: string; model: string }[] = [];

function stub(handler: Handler) {
  calls.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as { model: string };
    calls.push({ url: u, model: body.model });
    const r = handler(u, body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.text ?? "error body",
      json: async () => ({ choices: [{ message: { content: r.content ?? "" } }] }),
    } as unknown as Response;
  }) as typeof fetch;
}

async function main() {
  const chain = usableChatChain();
  assert.ok(chain.length >= 2, `need >=2 usable links to test fallback, got ${chain.length}`);
  const vendors = [...new Set(chain.map((l) => l.provider.id))];
  assert.ok(
    vendors.length >= 2,
    `fallback must cross VENDORS, chain covers only: ${vendors.join(",")}`,
  );

  // ── 1. Happy path: first link answers, nothing else is tried ───────────────
  {
    stub(() => ({ status: 200, content: "hello" }));
    const r = await callTextDetailed("p", { feature: "test" });
    assert.equal(r.text, "hello");
    assert.equal(calls.length, 1, "a working first link must not trigger further calls");
    assert.equal(r.attempts.length, 0, "no failed attempts on a first-try success");
    assert.equal(r.model, GROQ_FAST_MODEL, "should report the model that answered");
  }

  // ── 2. The 2026-08-18 outage: primary 404s, chain carries the call ─────────
  {
    let first = true;
    stub(() => {
      if (first) {
        first = false;
        return { status: 404, text: "model_not_found" };
      }
      return { status: 200, content: "rescued" };
    });
    const r = await callTextDetailed("p", { feature: "test" });
    assert.equal(r.text, "rescued", "a dead primary model must not be a dead feature");
    assert.ok(r.attempts.length >= 1, "the failed attempt must be recorded, not swallowed");
    assert.match(r.attempts[0].error, /404/, "the recorded attempt keeps the real status");
    assert.notEqual(
      r.model,
      GROQ_FAST_MODEL,
      "PROVENANCE: must report the model that answered, not the one requested",
    );
  }

  // ── 3. Daily cap: fallback must reach a DIFFERENT VENDOR ──────────────────
  // A 429 on tokens-per-day kills every model behind that key, so stepping to
  // another model at the same vendor is not a fallback at all.
  {
    stub((url) =>
      url.includes("api.groq.com")
        ? { status: 429, text: "Rate limit reached ... on tokens per day (TPD): Limit 100000" }
        : { status: 200, content: "other vendor" },
    );
    const r = await callTextDetailed("p", { feature: "test" });
    assert.equal(r.text, "other vendor");
    assert.notEqual(
      r.provider,
      "groq",
      "must land on a different vendor when one vendor is exhausted",
    );
    assert.ok(
      calls.some((c) => !c.url.includes("api.groq.com")),
      "the chain must actually leave the exhausted vendor's host",
    );
  }

  // ── 4. A 200 with empty content is a failure, not a success ────────────────
  {
    let n = 0;
    stub(() => (++n === 1 ? { status: 200, content: "  " } : { status: 200, content: "real" }));
    const r = await callTextDetailed("p", { feature: "test" });
    assert.equal(r.text, "real", "an empty completion must fall through, not be handed back");
    assert.equal(r.attempts.length, 1, "the empty response is recorded as a failed attempt");
  }

  // ── 5. fallback:false makes exactly ONE attempt ────────────────────────────
  {
    stub(() => ({ status: 500, text: "boom" }));
    await assert.rejects(
      () => callTextDetailed("p", { feature: "test", fallback: false }),
      /500/,
      "fallback:false must surface the failure rather than substituting a model",
    );
    assert.equal(calls.length, 1, "fallback:false must not try a second link");
  }

  // ── 6. Total outage names every vendor tried ──────────────────────────────
  {
    stub(() => ({ status: 503, text: "down" }));
    await assert.rejects(
      () => callGroqText("p", { feature: "test" }),
      (err: Error) => {
        assert.match(err.message, /all \d+ model link\(s\) failed/, "must report a CHAIN failure");
        assert.ok(calls.length >= 2, "every usable link must be tried before giving up");
        return true;
      },
    );
  }

  // ── 7. The judge panel must NOT fall back ─────────────────────────────────
  // Source-level, because the damage is invisible at runtime: a substituted
  // judge still returns scores, still gets recorded under the name of the model
  // that was ASKED for, and quietly turns two uncorrelated lineages into one
  // voter counted twice — disabling the veto floor the panel is built on.
  {
    const src = readFileSync("src/lib/frontier/propose.ts", "utf8");
    const judgeCall = src.slice(src.indexOf("async function runJudge"));
    assert.ok(
      /fallback:\s*false/.test(judgeCall.slice(0, 1400)),
      "runJudge must pass fallback:false — otherwise a dead judge is silently replaced by " +
        "the other judge's model and the panel reports two votes it never received",
    );
  }

  // ── 8. A fallback must not fire silently ──────────────────────────────────
  // The feature keeps working, so nothing LOOKS wrong while the primary is
  // dead — exactly how the 2026-08-18 rot survived eight days. And the silence
  // has to be meaningful in the other direction too: a clean call must stay
  // quiet, or the warning becomes noise nobody reads.
  {
    const realWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => {
      warnings.push(a.join(" "));
    };
    try {
      stub(() => ({ status: 200, content: "fine" }));
      await callTextDetailed("p", { feature: "test" });
      assert.equal(
        warnings.length,
        0,
        "a first-try success must not warn — silence has to mean 'nothing degraded'",
      );

      let first = true;
      stub(() => {
        if (first) {
          first = false;
          return { status: 404, text: "model_not_found" };
        }
        return { status: 200, content: "rescued" };
      });
      await callTextDetailed("p", { feature: "test" });
      assert.equal(warnings.length, 1, "a fallback must announce itself exactly once");
      assert.match(warnings[0], /\[ai\] fallback/, "the warning must be greppable in the journal");
      assert.match(warnings[0], /404|model_not_found/, "it must name WHY the primary was skipped");
    } finally {
      console.warn = realWarn;
    }
  }

  globalThis.fetch = realFetch;
  console.log(
    `✓ groq chain fallback: ${chain.length} link(s) across ${vendors.length} vendor(s); provenance + panel isolation hold`,
  );

  // Every refusal case above walks the vendor-error path, which fire-and-forgets
  // a quota write: `recordRefusal` -> `persist` -> lazy import of `@/db` ->
  // `postgres(url, { max: 5 })`. Nothing closes that pool, so its sockets hold
  // the event loop open and this process never exits on its own.
  //
  // It cost fifty-six minutes of every CI run before anyone looked, and it was
  // invisible locally: with no DATABASE_URL the import rejects and the process
  // exits in two seconds, so the hang exists only where a database does.
  //
  // Exiting here is safe precisely because that write is worthless — the
  // readings come from a stubbed vendor answering a fake key, so persisting
  // them would put fiction in the quota table. This is the same ending the
  // other database-touching tests use (rag-retrieval, telegram-allowlist).
  process.exit(0);
}

void main();
