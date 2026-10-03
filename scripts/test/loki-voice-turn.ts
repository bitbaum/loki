// The voice conversation's endpointing: a turn ends on a pause AFTER speech,
// never on the quiet before it, and a click is not a turn.
import assert from "node:assert/strict";
import {
  decideVoiceTurn,
  newVoiceTurn,
  sampleVoiceTurn,
  VOICE_END_SILENCE_MS,
  VOICE_IDLE_MS,
  VOICE_MAX_TURN_MS,
  VOICE_SPEECH_LEVEL,
  speechThreshold,
  type VoiceTurnState,
} from "@/lib/loki/voice-turn";

const LOUD = VOICE_SPEECH_LEVEL + 0.1;
const QUIET = VOICE_SPEECH_LEVEL / 4;

/** Feed (level, durationMs) segments at 16ms frames. */
function run(segments: [number, number][]): { s: VoiceTurnState; t: number } {
  let t = 0;
  let s = newVoiceTurn(0);
  for (const [level, ms] of segments) {
    for (let i = 0; i < ms; i += 16) {
      t += 16;
      s = sampleVoiceTurn(s, level, t);
    }
  }
  return { s, t };
}

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

check(() => {
  // Quiet before speaking is thinking, not the end.
  const { s, t } = run([[QUIET, 5000]]);
  assert.equal(decideVoiceTurn(s, t), "continue");
});
check(() => {
  const { s, t } = run([[QUIET, VOICE_IDLE_MS + 100]]);
  assert.equal(decideVoiceTurn(s, t), "idle");
});
check(() => {
  // A sentence, then a short pause: still talking.
  const { s, t } = run([
    [LOUD, 1500],
    [QUIET, VOICE_END_SILENCE_MS - 300],
  ]);
  assert.equal(decideVoiceTurn(s, t), "continue");
});
check(() => {
  const { s, t } = run([
    [LOUD, 1500],
    [QUIET, VOICE_END_SILENCE_MS + 100],
  ]);
  assert.equal(decideVoiceTurn(s, t), "send");
});
check(() => {
  // A click: loud for one frame, then quiet.
  const { s, t } = run([
    [LOUD, 16],
    [QUIET, VOICE_END_SILENCE_MS + 100],
  ]);
  assert.equal(decideVoiceTurn(s, t), "discard");
});
check(() => {
  // Talking without a pause past the cap: send what there is.
  const { s, t } = run([[LOUD, VOICE_MAX_TURN_MS + 50]]);
  assert.equal(decideVoiceTurn(s, t), "send");
});

check(() => {
  // A noisy room raises the bar; a quiet one keeps the floor.
  assert.equal(speechThreshold(0.001), VOICE_SPEECH_LEVEL);
  assert.ok(speechThreshold(0.05) > 0.05);
});

console.log(`${n}/7 loki-voice-turn cases passed`);
