// A thumbs-down becomes a feedback report that stands on its own and always
// fits the ingest's 2000-character suggestion cap.
import assert from "node:assert/strict";
import { ANSWER_REPORT_MAX_CHARS, buildAnswerReport } from "@/lib/loki/answer-report";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

check(() => {
  const r = buildAnswerReport({
    note: "It invented a meeting",
    question: "What's tomorrow?",
    answer: "A 9am standup.",
  });
  assert.ok(r.startsWith("Bad answer in Loki chat: It invented a meeting"));
  assert.ok(r.includes("Question:\nWhat's tomorrow?"));
  assert.ok(r.endsWith("Answer:\nA 9am standup."));
});
check(() => {
  const r = buildAnswerReport({ note: "  ", question: null, answer: "x" });
  assert.ok(r.startsWith("Bad answer in Loki chat (no reason given)."));
  assert.ok(!r.includes("Question:"));
});
check(() => {
  const r = buildAnswerReport({
    note: "n".repeat(5000),
    question: "q".repeat(5000),
    answer: "a".repeat(9000),
  });
  assert.ok(r.length <= ANSWER_REPORT_MAX_CHARS, `length ${r.length}`);
  assert.ok(r.includes("Answer:\naaa"));
});

console.log(`${n}/3 loki-answer-report cases passed`);
