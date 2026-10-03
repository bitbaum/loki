// Suggested follow-ups: whatever the fast model returns must become at most
// three clean tap targets — never a numbered list, a preamble or a paragraph.
import assert from "node:assert/strict";
import {
  buildFollowUpPrompt,
  FOLLOW_UP_INPUT_CHARS,
  FOLLOW_UP_MAX_CHARS,
  parseFollowUps,
} from "@/lib/loki/follow-ups";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  void name;
};

ok("plain lines", () => {
  assert.deepEqual(parseFollowUps("Make it longer\nMake it funnier\nAdd a title"), [
    "Make it longer",
    "Make it funnier",
    "Add a title",
  ]);
});
ok("numbering, bullets and quotes are stripped", () => {
  assert.deepEqual(parseFollowUps('1. "Make it longer"\n- Make it shorter\n• ↳ Add a title'), [
    "Make it longer",
    "Make it shorter",
    "Add a title",
  ]);
});
ok("a preamble line is dropped", () => {
  assert.deepEqual(parseFollowUps("Here are some follow-ups:\nA\nB"), ["A", "B"]);
});
ok("a JSON array is read", () => {
  assert.deepEqual(parseFollowUps('["One", "Two"]'), ["One", "Two"]);
});
ok("duplicates, blanks and overlong lines go; at most three", () => {
  const long = "x".repeat(FOLLOW_UP_MAX_CHARS + 1);
  assert.deepEqual(parseFollowUps(`A\n\na\n${long}\nB\nC\nD`), ["A", "B", "C"]);
});
ok("nothing usable → empty, never a throw", () => {
  assert.deepEqual(parseFollowUps(""), []);
  assert.deepEqual(parseFollowUps("{}"), []);
});
ok("the prompt clips both sides", () => {
  const p = buildFollowUpPrompt("q".repeat(9000), "a".repeat(9000));
  assert.ok(p.length < FOLLOW_UP_INPUT_CHARS * 2 + 100);
});

console.log(`${n}/7 loki-follow-ups cases passed`);
