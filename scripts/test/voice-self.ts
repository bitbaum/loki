// Voice mode knows itself: the voice command's answers, "other voice" going
// round the studio voices, and the facts put ahead of a spoken question — all
// read from config/no-screen.ts, so a voice or command added there is known
// here without retyping it.
import assert from "node:assert/strict";
import {
  NO_SCREEN_COMMANDS,
  NO_SCREEN_DEFAULT_SETTINGS,
  NO_SCREEN_DEFAULT_VOICE,
  NO_SCREEN_OPTIONS,
  NO_SCREEN_VOICES,
} from "../../src/config/no-screen";
import {
  askInVoiceMode,
  composeVoiceList,
  composeVoiceSwitched,
  nextVoice,
  resolveVoiceChoice,
  voiceModeContext,
} from "../../src/lib/voice/self";
import { studioVoiceOffSentence, ttsFailure } from "../../src/lib/voice/tts-failure";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

const studio = NO_SCREEN_VOICES.filter((v) => v.id !== "phone");

check(() => {
  // "Other voice" visits every studio voice once, then wraps; never the phone.
  const seen = new Set<string>();
  let v = studio[0].id;
  for (let i = 0; i < studio.length; i++) {
    seen.add(v);
    v = nextVoice(v);
  }
  assert.equal(seen.size, studio.length);
  assert.equal(v, studio[0].id);
  assert.equal(nextVoice("phone"), NO_SCREEN_DEFAULT_VOICE);
  assert.equal(resolveVoiceChoice("troy", "autumn"), "troy");
  assert.equal(resolveVoiceChoice("next", "phone"), NO_SCREEN_DEFAULT_VOICE);
  assert.equal(resolveVoiceChoice(null, "autumn"), null);
});

check(() => {
  const l = composeVoiceList("troy");
  for (const v of NO_SCREEN_VOICES.filter((x) => x.id !== "phone")) assert.ok(l.includes(v.label));
  assert.match(l, /phone's own voice/);
  assert.match(l, /Right now it's Troy\./);
  assert.match(l, /Say "use" and a name/);
  assert.match(composeVoiceList("phone"), /Right now it's your phone's own voice\./);
});

check(() => {
  assert.equal(
    composeVoiceSwitched("troy", null),
    'Troy here. Say "other voice" to hear the next one.',
  );
  // A switch that changes nothing audible says so.
  const off = studioVoiceOffSentence(ttsFailure("terms"));
  const s = composeVoiceSwitched("diana", off);
  assert.match(s, /^Switched to Diana, but you will still hear your phone's voice\./);
  assert.ok(s.includes(off));
  assert.match(composeVoiceSwitched("phone", null), /phone's own voice/);
});

check(() => {
  const ctx = voiceModeContext({ ...NO_SCREEN_DEFAULT_SETTINGS, voice: "troy", music: false });
  // Every voice by name, the way to change it, the switches, every command.
  for (const v of studio) assert.ok(ctx.includes(v.label), v.label);
  assert.match(ctx, /Right now: Troy\./);
  assert.match(ctx, /"use" and a name/);
  for (const o of Object.values(NO_SCREEN_OPTIONS)) {
    assert.ok(ctx.includes(o.title), o.title);
    assert.ok(ctx.includes(o.note), o.note);
  }
  assert.match(ctx, /Music bed \(now off\)/);
  assert.match(ctx, /Talk to interrupt \(now on\)/);
  for (const c of NO_SCREEN_COMMANDS) assert.ok(ctx.includes(`"${c.say[0]}"`), c.say[0]);
  // It forbids the generic-assistant answer the owner got.
  assert.match(ctx, /Never describe how other apps/);
  // Studio voices off: the reason travels with the question.
  const off = studioVoiceOffSentence(ttsFailure("terms"));
  assert.ok(voiceModeContext({ ...NO_SCREEN_DEFAULT_SETTINGS, studioOff: off }).includes(off));
  // Without a screen's state it still describes the mode, without claiming a current voice.
  assert.ok(!voiceModeContext(null).includes("Right now:"));
});

check(() => {
  const q = askInVoiceMode("Can I change your voice?", null);
  assert.ok(q.endsWith("\n\n---\n\nCan I change your voice?"));
  assert.ok(q.startsWith("This question was SPOKEN"));
});

console.log(`voice-self: ${n} checks ok`);
