// Why the studio voice did not speak: Groq's refusal → one reason, one plain
// sentence, and the link that fixes it. The terms gate is the case the owner
// hit (every voice sounded like the phone's, and nothing said why), so it is
// pinned by Groq's own error shape.
import assert from "node:assert/strict";
import { NO_SCREEN_TTS_MODEL } from "../../src/config/no-screen";
import {
  GROQ_VOICE_TERMS_URL,
  classifyTtsFailure,
  readTtsFailure,
  studioVoiceOffSentence,
  ttsFailure,
} from "../../src/lib/voice/tts-failure";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

const groq = (code: string, message: string, type = "invalid_request_error") =>
  JSON.stringify({ error: { message, type, code } });

check(() => {
  // Groq answers the org-level terms gate with a plain 400.
  const f = classifyTtsFailure(
    400,
    groq(
      "model_terms_required",
      `The model \`${NO_SCREEN_TTS_MODEL}\` requires terms acceptance. Please have the org admin accept the terms at https://console.groq.com/playground?model=${NO_SCREEN_TTS_MODEL}`,
    ),
  );
  assert.equal(f.reason, "terms");
  assert.equal(f.fix?.url, GROQ_VOICE_TERMS_URL);
  assert.ok(GROQ_VOICE_TERMS_URL.includes(NO_SCREEN_TTS_MODEL));
  assert.match(f.fix?.steps ?? "", /Accept/);
  // Without the code, the words still find it.
  assert.equal(classifyTtsFailure(400, groq("", "Please accept the model terms")).reason, "terms");
});

check(() => {
  assert.equal(
    classifyTtsFailure(401, groq("invalid_api_key", "Invalid API Key")).reason,
    "bad-key",
  );
  assert.equal(classifyTtsFailure(401, "").reason, "bad-key");
  assert.equal(classifyTtsFailure(403, "Forbidden").reason, "bad-key");
  assert.equal(
    classifyTtsFailure(429, groq("rate_limit_exceeded", "Rate limit reached", "tokens")).reason,
    "limit",
  );
  assert.equal(classifyTtsFailure(429, "").reason, "limit");
  assert.equal(
    classifyTtsFailure(404, groq("model_not_found", "The model does not exist")).reason,
    "model-gone",
  );
  assert.equal(
    classifyTtsFailure(400, groq("model_decommissioned", "decommissioned")).reason,
    "model-gone",
  );
  assert.equal(classifyTtsFailure(503, "<html>bad gateway</html>").reason, "vendor-down");
  assert.equal(classifyTtsFailure(400, "{not json").reason, "unknown");
});

check(() => {
  // Every reason has a sentence; a fix, when there is one, is an https link.
  for (const r of [
    "terms",
    "no-key",
    "bad-key",
    "limit",
    "model-gone",
    "vendor-down",
    "unreachable",
    "unknown",
  ] as const) {
    const f = ttsFailure(r);
    assert.ok(f.explain.endsWith("."), `${r}: ${f.explain}`);
    if (f.fix) assert.match(f.fix.url, /^https:\/\//);
  }
});

check(() => {
  // The phone reads what the route sent; anything else is "unreachable".
  assert.equal(readTtsFailure({ reason: "terms", explain: "x" }).reason, "terms");
  assert.equal(readTtsFailure({ reason: "made-up" }).reason, "unreachable");
  assert.equal(readTtsFailure(null).reason, "unreachable");
});

check(() => {
  const s = studioVoiceOffSentence(ttsFailure("terms"));
  assert.equal(
    s,
    "Studio voices are off: Groq needs its voice terms accepted once before it will speak. Until then Loki reads with your phone's voice, so every voice sounds the same.",
  );
  assert.match(studioVoiceOffSentence(ttsFailure("no-key")), /^Studio voices are off: this server/);
});

console.log(`voice-tts-failure: ${n} checks ok`);
