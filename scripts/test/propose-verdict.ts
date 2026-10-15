/**
 * "Zero proposals" has four causes, and they need four different fixes.
 *
 * The frontier loop surfaced nothing from 2026-06-24 to 2026-08-25 — two
 * months — and the only fact that survived each night was `drafted: 0`. A dead
 * model, an unparseable reply, a model that genuinely found no match, and a
 * dedup filter eating every draft all produce that same zero, and they call for
 * a repin, a prompt change, a rethink of the input, and a looser filter
 * respectively. Collapsing them made the next step unknowable.
 *
 * Same shape one layer up: a judge panel that cannot be reached fails closed,
 * which is correct, and looks identical to a panel that considered the
 * proposals and rejected them — which is not.
 *
 * Pure unit test: the model call is stubbed, no network, no DB.
 * Auto-discovered by scripts/test-unit.ts.
 */
import Module from "node:module";

// Stub @/lib/groq BEFORE propose.ts is loaded, so the generator and the judges
// call our fake instead of Groq. Each test sets `reply`.
type Reply = { throws?: string; text?: string };
let reply: Reply = {};
const groqPath = require.resolve("../../src/lib/groq");
require.cache[groqPath] = {
  id: groqPath,
  filename: groqPath,
  loaded: true,
  paths: [],
  exports: {
    GROQ_FAST_MODEL: "stub-model",
    GROQ_STRONG_MODEL: "stub/strong-model",
    GROQ_WHISPER_MODEL: "stub-whisper",
    callGroqText: async () => {
      if (reply.throws) throw new Error(reply.throws);
      return reply.text ?? "";
    },
  },
} as unknown as Module;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateProposals, verifyProposals } = require("../../src/lib/frontier/propose");

const ITEMS = [
  { title: "A paper", summary: "about agents", url: "https://example.com/a", category: "ai" },
];
const CTX = { activeGoalTitles: [], consideredTitles: [], openGaps: [], recentlyShipped: [] };

const ok = (name: string, cond: boolean) => {
  if (!cond) {
    console.error(`✗ ${name}`);
    process.exit(1);
  }
  console.log(`  ✓ ${name}`);
};

async function main() {
  // ── 1. the model call THREW — an outage, not an opinion ────────────────────
  {
    reply = { throws: "groq 404: model_not_found" };
    const r = await generateProposals(ITEMS, CTX);
    ok("a failed model call is reported as call-failed, not silence", r.outcome === "call-failed");
    ok("…and carries the error text a repin would need", /model_not_found/.test(r.error ?? ""));
    ok("…with no drafts", r.drafts.length === 0);
  }

  // ── 2. a reply arrived but no JSON could be extracted ──────────────────────
  {
    reply = { text: "I'm afraid I can't help with that." };
    const r = await generateProposals(ITEMS, CTX);
    ok("an unparseable reply is distinguishable from an empty one", r.outcome === "unparseable");
  }

  // ── 3. valid JSON, model deliberately proposed nothing ─────────────────────
  {
    reply = { text: '{"proposals":[]}' };
    const r = await generateProposals(ITEMS, CTX);
    ok("a deliberate empty list says model-returned-empty", r.outcome === "model-returned-empty");
    ok("…and returned is 0", r.returned === 0);
  }

  // ── 4. the model proposed, and WE threw it all away ────────────────────────
  {
    // The dedup net drops anything too similar to an already-considered title.
    reply = {
      text: JSON.stringify({
        proposals: [
          {
            title: "Improve the orchestration run close path",
            rationale: "because",
            sourceUrls: [],
          },
        ],
      }),
    };
    const r = await generateProposals(ITEMS, {
      ...CTX,
      consideredTitles: ["Improve the orchestration run close path"],
    });
    ok(
      "dedup-eaten drafts are NOT reported as the model having no ideas",
      r.outcome === "all-deduped",
    );
    ok("…and `returned` proves the model DID propose", r.returned === 1);
    ok("…while drafted is still 0", r.drafts.length === 0);
  }

  // ── 5. the judge panel is unreachable — fails closed, but says why ─────────
  {
    reply = { throws: "groq 429: rate limited" };
    const drafts = [{ title: "T", rationale: "R", sourceUrls: [] }];
    const v = await verifyProposals(drafts);
    ok("an unreachable panel is flagged, not reported as a rejection", v.panelUnreachable === true);
    ok("…every judge failure is named with its reason", v.judgeFailures.length >= 1);
    ok(
      "…and the proposal still fails closed",
      v.verified.every((p: { passed: boolean }) => !p.passed),
    );
  }

  // ── 6. a WORKING panel that rejects is not flagged as broken ───────────────
  {
    reply = { text: '{"scores":[{"index":0,"score":10}]}' };
    const drafts = [{ title: "T", rationale: "R", sourceUrls: [] }];
    const v = await verifyProposals(drafts);
    ok("a real rejection is not mistaken for an outage", v.panelUnreachable === false);
    ok("…with no judge failures", v.judgeFailures.length === 0);
    ok(
      "…and the low score still fails the bar",
      v.verified.every((p: { passed: boolean }) => !p.passed),
    );
  }

  console.log("✓ propose-verdict: zero proposals now names which of four causes");
}

void main();
