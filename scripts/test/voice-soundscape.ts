// The sounds as numbers: every earcon is a cue, not a jingle; the music bed
// sits below the voice; and a briefing is cut for the studio voice at
// sentence ends first, never mid-word.
import assert from "node:assert/strict";
import { NO_SCREEN_TTS_MAX_CHARS } from "../../src/config/no-screen";
import {
  EARCONS,
  EARCON_MAX_SECONDS,
  MUSIC,
  MUSIC_PROGRESSION,
  chordAt,
  midiToHz,
} from "../../src/lib/voice/soundscape";
import { splitForSpeech } from "../../src/lib/voice/speak-chunks";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

check(() => {
  for (const [kind, notes] of Object.entries(EARCONS)) {
    assert.ok(notes.length >= 1 && notes.length <= 3, `${kind} has ${notes.length} notes`);
    const end = Math.max(...notes.map((x) => x.at + x.dur));
    assert.ok(end <= EARCON_MAX_SECONDS, `${kind} lasts ${end}s`);
  }
  // Good news rises, bad news falls.
  const rises = (k: keyof typeof EARCONS) =>
    EARCONS[k][EARCONS[k].length - 1].midi > EARCONS[k][0].midi;
  assert.ok(rises("finished") && rises("online"));
  assert.ok(!rises("failed") && !rises("offline"));
  assert.equal(EARCONS.attention[0].midi, EARCONS.attention[1].midi);
});

check(() => {
  assert.equal(Math.round(midiToHz(69)), 440);
  assert.equal(Math.round(midiToHz(57)), 220);
  // The bed lives under the voice band: nothing above ~330 Hz (E4, MIDI 64).
  for (const chord of MUSIC_PROGRESSION)
    for (const m of chord) assert.ok(m <= 66, `note ${m} is too high for a bed`);
  assert.ok(MUSIC.ducked < MUSIC.level && MUSIC.level < 0.2);
  assert.deepEqual(chordAt(MUSIC_PROGRESSION.length), MUSIC_PROGRESSION[0]);
  assert.deepEqual(chordAt(-1), MUSIC_PROGRESSION[MUSIC_PROGRESSION.length - 1]);
});

check(() => {
  assert.deepEqual(splitForSpeech("  "), []);
  assert.deepEqual(splitForSpeech("Short."), ["Short."]);
  const long =
    'One agent is working: heidi for 12 minutes. One run is waiting for a builder: solon. One thing is waiting on you. Say "what\'s waiting" to hear it. One run failed: orangecat. Say "what failed" for the errors.';
  const pieces = splitForSpeech(long);
  assert.ok(pieces.length >= 2);
  for (const p of pieces) assert.ok(p.length <= NO_SCREEN_TTS_MAX_CHARS, p);
  // Cuts at sentence ends: every piece but the last ends a sentence.
  for (const p of pieces.slice(0, -1)) assert.match(p, /[.!?]$/);
  assert.equal(pieces.join(" "), long);
});

check(() => {
  // A single sentence longer than the limit is cut at a clause, then at a word.
  const clause = Array.from({ length: 12 }, (_, i) => `part ${i} of the sentence`).join(", ") + ".";
  const pieces = splitForSpeech(clause, 60);
  for (const p of pieces) assert.ok(p.length <= 60 && !p.startsWith(" "));
  const word = "word ".repeat(50).trim();
  for (const p of splitForSpeech(word, 24)) assert.ok(p.length <= 24 && /^word( word)*$/.test(p));
});

console.log(`voice-soundscape: ${n} checks ok`);
