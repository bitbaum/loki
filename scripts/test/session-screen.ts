/** A session's terminal output, as text a model reads (lib/session-screen). */
import assert from "node:assert/strict";
import { plainSessionText } from "../../src/lib/session-screen";

assert.equal(plainSessionText("\x1b[1mhello\x1b[0m\r\n"), "hello", "escape sequences go");
assert.equal(
  plainSessionText("thinking…\rDone.\n"),
  "Done.",
  "a redrawn line shows its last write",
);
assert.equal(plainSessionText("a\n\n\n\nb\nb\nc"), "a\n\nb\nc", "repeats collapse");
assert.equal(plainSessionText("\x1b]0;title\x07x"), "x", "window titles go");
assert.equal(plainSessionText(""), "");
const long = plainSessionText(`${"x".repeat(50)}END`, 10);
assert.equal(long.length, 10);
assert.ok(long.startsWith("…") && long.endsWith("END"), "the end is what is kept");

console.log("session-screen ok");
