/**
 * Silence that Whisper put words to is not sent as the person's turn.
 *
 * Run: npx tsx scripts/test/whisper-silence.ts
 */
import assert from "node:assert/strict";
import { isSilenceSegment, spokenText } from "../../src/lib/voice/whisper-silence";

// The take from the operator's phone: room noise, transcribed as a sign-off.
assert.equal(
  spokenText({
    text: " Thank you.",
    segments: [{ text: " Thank you.", no_speech_prob: 0.42, avg_logprob: -0.6 }],
  }),
  "",
  "an invented sign-off on a noisy take is nothing",
);
// The reference decoder's rule: sure there is no speech, unsure of the words.
assert.ok(isSilenceSegment({ text: " Okay so", no_speech_prob: 0.8, avg_logprob: -1.3 }));
// Said plainly, the same words are kept.
assert.equal(
  spokenText({ segments: [{ text: " Thank you.", no_speech_prob: 0.01, avg_logprob: -0.2 }] }),
  "Thank you.",
);
// A real sentence is never dropped for a modest no-speech estimate.
assert.equal(
  spokenText({
    segments: [{ text: " Fix the small text on kestrel.", no_speech_prob: 0.4, avg_logprob: -0.3 }],
  }),
  "Fix the small text on kestrel.",
);
// Only the invented tail goes; what was said before it stays.
assert.equal(
  spokenText({
    segments: [
      { text: " Ship it tonight.", no_speech_prob: 0.02, avg_logprob: -0.25 },
      { text: " Bis zum nächsten Mal.", no_speech_prob: 0.5, avg_logprob: -0.7 },
    ],
  }),
  "Ship it tonight.",
);
// Punctuation and case do not hide a silence line.
assert.ok(isSilenceSegment({ text: "THANKS FOR WATCHING!", no_speech_prob: 0.3 }));
// A response with no segments (an older shape) falls back to its text.
assert.equal(spokenText({ text: "  hello there " }), "hello there");

console.log("✓ whisper silence: invented sign-offs are not a turn");
