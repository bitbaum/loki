/**
 * The fleet chat-review loop, Loki's side, without a model or a database:
 * a conversation becomes the transcript the judge reads, the judge's input is
 * chatkit's contract, the agent's prompt carries it with the night's budget,
 * and a review becomes the finding an operator reads in the inbox.
 * Run: npx tsx scripts/test/chat-review.ts
 */
import assert from "node:assert/strict";
import {
  CHAT_REVIEW_INSTRUCTION,
  parseChatReview,
  type ChatReview,
  type ChatTranscript,
} from "@bitbaum/chatkit";
import {
  CHAT_REVIEW_PRODUCTS,
  REVIEW_EXPORT_MAX_TURNS,
  REVIEW_FILE_BELOW_SCORE,
  REVIEW_MAX_FINDINGS_PER_PRODUCT,
} from "../../src/config/chat-review";
import { judgeInput } from "../../src/lib/chat-review/judge";
import {
  PROMPT_TRANSCRIPT_BUDGET,
  composeChatReviewPrompt,
} from "../../src/lib/chat-review/prompt";
import {
  FINDING_MAX_CHARS,
  byUrgency,
  findingText,
  isFinding,
} from "../../src/lib/chat-review/finding";
import { toTranscript } from "../../src/lib/chat-review/transcripts";

let n = 0;
const check = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => {
    n++;
    console.log(`  ✓ ${name}`);
  });

const at = new Date("2026-10-22T03:00:00Z");
const msg = (
  id: string,
  role: string,
  content: string,
  meta: Record<string, unknown> | null = null,
) => ({
  id,
  role,
  content,
  meta,
  createdAt: at,
});
const PROJECT = { id: "11111111-1111-4111-8111-111111111111", name: "substrata" };

const transcript: ChatTranscript = {
  id: "c1",
  at: at.toISOString(),
  surface: "/loki",
  turns: [
    { id: "u1", role: "user", content: "What's open on substrata?" },
    { id: "a1", role: "assistant", content: "Nothing in our database." },
  ],
};

async function main() {
  process.env.AUTH_SECRET ??= "test-secret";

  await check("every product in the loop exports from its own origin, under one path", () => {
    assert.deepEqual(
      CHAT_REVIEW_PRODUCTS.map((p) => p.key),
      ["heidi", "orangecat", "substrata", "loki"],
    );
    for (const p of CHAT_REVIEW_PRODUCTS) {
      assert.ok(p.exportUrl.endsWith("/api/chat/review-export"), p.exportUrl);
      assert.match(p.repo, /^bitbaum\/[a-z-]+$/);
    }
  });

  await check(
    "a conversation becomes the transcript the judge reads: ids, steps, thumbs, no names",
    () => {
      const t = toTranscript({
        id: "c1",
        updatedAt: at,
        projectKeys: ["second-cafe"],
        messages: [
          msg("s0", "system", "ignored"),
          msg("u1", "user", "Who owns the failing run?"),
          msg("a1", "assistant", "Both are on sink.", {
            ok: true,
            work: [
              { kind: "note", text: "Checking the runs." },
              { kind: "tool", name: "runs", phase: "end", detail: 'project: "sink"' },
            ],
          }),
          msg("u2", "user", "Retry it"),
          msg("a2", "assistant", "Could not dispatch.", { ok: false }),
        ],
        feedback: [
          { messageId: "a2", verdict: "down", reason: "dead_end", text: "no way forward" },
          { messageId: "zzz", verdict: "down", reason: null, text: null },
          { messageId: "a1", verdict: "up", reason: "not-a-reason", text: null },
        ],
      });
      assert.equal(t.surface, "/loki?project=second-cafe");
      assert.deepEqual(
        t.turns.map((x) => x.id),
        ["u1", "a1", "u2", "a2"],
      );
      assert.deepEqual(t.turns[1].steps, ["Checking the runs.", 'runs project: "sink"']);
      assert.equal(t.turns[1].failed, undefined);
      assert.equal(t.turns[3].failed, true);
      assert.deepEqual(t.feedback, [
        { messageId: "a2", verdict: "down", reason: "dead_end", text: "no way forward" },
        { messageId: "a1", verdict: "up" },
      ]);
      assert.ok(!JSON.stringify(t).includes("user_id"));
    },
  );

  await check("a long thread keeps its last turns, inside the export's cap", () => {
    const messages = Array.from({ length: 80 }, (_, i) =>
      msg(`m${i}`, i % 2 ? "assistant" : "user", "x".repeat(5000)),
    );
    const t = toTranscript({ id: "c", updatedAt: at, projectKeys: [], messages, feedback: [] });
    assert.equal(t.turns.length, REVIEW_EXPORT_MAX_TURNS);
    assert.equal(t.turns[0].id, "m50");
    assert.equal(t.turns[0].content.length, 4000);
  });

  await check("the judge is asked with chatkit's instruction and prompt, nothing added", () => {
    const input = judgeInput("It can read the operator's projects.", transcript);
    assert.equal(input.system, CHAT_REVIEW_INSTRUCTION);
    assert.ok(input.user.startsWith("## What this assistant can do\nIt can read"));
    assert.ok(input.user.includes("[a1] ASSISTANT:\nNothing in our database."));
  });

  await check(
    "the agent's prompt carries chatkit's words, the budget, and the door to file through",
    () => {
      const prompt = composeChatReviewPrompt({
        product: CHAT_REVIEW_PRODUCTS[2],
        scope: "It reads market records; it has no web search.",
        transcripts: [transcript, { ...transcript, id: "c2", surface: "/markets/asml" }],
        project: PROJECT,
        widgetToken: "fcw_test",
      });
      assert.ok(prompt.includes(CHAT_REVIEW_INSTRUCTION));
      assert.ok(prompt.includes("It reads market records; it has no web search."));
      assert.ok(prompt.includes("### Conversation c1 (2026-10-22, on /loki)"));
      assert.ok(prompt.includes("### Conversation c2 (2026-10-22, on /markets/asml)"));
      assert.ok(prompt.includes("[a1] ASSISTANT:\nNothing in our database."));
      assert.ok(prompt.includes(`File at most ${REVIEW_MAX_FINDINGS_PER_PRODUCT}`));
      assert.ok(prompt.includes(`score is under ${REVIEW_FILE_BELOW_SCORE}`));
      assert.ok(prompt.includes('"token":"fcw_test"'));
      assert.ok(prompt.includes('-H "Origin: https://substrata.orangecat.ch"'));
      assert.match(
        prompt,
        /"agentPass":"11111111-1111-4111-8111-111111111111\.ai_review\.\d+\.[\w-]+"/,
      );
      assert.ok(prompt.includes("Chat answer scored 2/5 — a dead end, no next step."));
    },
  );

  await check("a day too long for one prompt is cut by whole conversations, and says so", () => {
    const big = Array.from({ length: 40 }, (_, i) => ({
      ...transcript,
      id: `c${i}`,
      turns: transcript.turns.map((t) => ({ ...t, content: "x".repeat(4000) })),
    }));
    const prompt = composeChatReviewPrompt({
      product: CHAT_REVIEW_PRODUCTS[0],
      scope: "s",
      transcripts: big,
      project: PROJECT,
      widgetToken: "fcw_test",
    });
    assert.ok(prompt.length < PROMPT_TRANSCRIPT_BUDGET + 20_000, `prompt is ${prompt.length}`);
    assert.match(prompt, /\d+ of 40; \d+ left out for length/);
  });

  await check("the judge's answer reads back through chatkit, unknown gaps dropped", () => {
    const reviews = parseChatReview(
      JSON.stringify({
        reviews: [
          { messageId: "a1", score: 1, gaps: ["dead_end", "no_next_step", "nonsense"], fix: "f" },
        ],
      }),
    );
    assert.equal(reviews.length, 1);
    assert.deepEqual(reviews[0].gaps, ["dead_end", "no_next_step"]);
  });

  await check("a finding is a low score or any gap; the worst is filed first", () => {
    const r = (score: ChatReview["score"], gaps: ChatReview["gaps"]): ChatReview => ({
      messageId: "a1",
      score,
      expected: "",
      deliverable: "",
      delivered: "",
      gaps,
      fix: "",
    });
    assert.equal(isFinding(r(REVIEW_FILE_BELOW_SCORE as ChatReview["score"], [])), false);
    assert.equal(isFinding(r(3, [])), true);
    assert.equal(isFinding(r(5, ["no_next_step"])), true);
    const sorted = [r(4, ["vague"]), r(1, ["dead_end"]), r(1, ["dead_end", "no_web"])].sort(
      byUrgency,
    );
    assert.deepEqual(
      sorted.map((x) => [x.score, x.gaps.length]),
      [
        [1, 2],
        [1, 1],
        [4, 1],
      ],
    );
  });

  await check("the finding reads on its own in the inbox and names the conversation", () => {
    const text = findingText(
      {
        messageId: "a1",
        score: 1,
        expected: "the open tasks on substrata",
        deliverable: "a list from the project's records, or a web lookup",
        delivered: '"nothing in our database" and nothing else',
        gaps: ["dead_end", "no_web"],
        fix: "when the search finds nothing, look at the open web and offer the next step",
      },
      transcript,
    );
    assert.equal(
      text,
      "Chat answer scored 1/5 — a dead end, no web lookup. " +
        "The person wanted: the open tasks on substrata. " +
        "We could have given: a list from the project's records, or a web lookup. " +
        'We gave: "nothing in our database" and nothing else. ' +
        "Fix: when the search finds nothing, look at the open web and offer the next step. " +
        "(conversation c1, message a1, 2026-10-22)",
    );
  });

  await check("a finding never exceeds the ingest's cap, and keeps its ids", () => {
    const text = findingText(
      {
        messageId: "a1",
        score: 2,
        expected: "e".repeat(600),
        deliverable: "d".repeat(600),
        delivered: "g".repeat(600),
        gaps: [],
        fix: "f".repeat(600),
      },
      transcript,
    );
    assert.ok(text.length <= FINDING_MAX_CHARS, `length ${text.length}`);
    assert.ok(text.endsWith("(conversation c1, message a1, 2026-10-22)"));
  });

  console.log(`\n${n} chat-review cases passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
