/**
 * An answer read aloud is prose, not markdown syntax. Pure.
 */
import assert from "node:assert/strict";
import { guessSpeechLang, plainTextForSpeech } from "../../src/lib/loki/speech-text";

const spoken = plainTextForSpeech(
  "## Summary\n\n- **Two runs** failed [F8] on `sink` [D1].\n- See [the log](https://x.y/z).\n\n```sh\nls\n```\n\n> quoted\n\n| a | b |",
);
assert.equal(spoken.includes("#"), false, "no heading marks");
assert.equal(spoken.includes("*"), false, "no emphasis marks");
assert.equal(spoken.includes("[F8]"), false, "no citations");
assert.equal(spoken.includes("https://"), false, "no urls");
assert.equal(spoken.includes("`"), false, "no backticks");
assert.match(spoken, /Two runs failed on sink/, "the words survive");
assert.match(spoken, /the log/, "link text survives");
assert.match(spoken, /\(code\)/, "code is named, not read");
assert.equal(plainTextForSpeech("   "), "");

assert.equal(guessSpeechLang("Die zwei Runs sind nicht mehr auf der Liste und das ist gut."), "de");
assert.equal(guessSpeechLang("The two runs are not on the list and that is fine."), "en");
assert.equal(guessSpeechLang("ok", "fr"), "fr", "too short to tell → the page's language");

console.log("loki-speech-text: ok");
