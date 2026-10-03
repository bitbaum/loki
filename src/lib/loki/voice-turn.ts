/**
 * When has the speaker finished? The endpointing rule for a hands-free voice
 * conversation, kept pure so it is pinned without a microphone
 * (scripts/test/loki-voice-turn.ts).
 *
 * The input is the microphone's loudness, sampled every animation frame: the
 * RMS of the waveform (0–1). Not the loudest frequency bin, which a quiet room
 * already pushes to a third of full scale. The bar for "speech" rises with the
 * room's own noise floor (speechThreshold), so a café does not read as one
 * long sentence. A turn ends after a stretch of quiet that
 * FOLLOWS speech; quiet before anyone has spoken is someone gathering their
 * thoughts, and ending there would send an empty take to the transcriber —
 * which answers silence with words nobody said.
 */

/** RMS above this counts as speech in a quiet room (quiet sits near 0.01). */
export const VOICE_SPEECH_LEVEL = 0.04;
/** In a noisy room speech must stand this far above the noise floor. */
export const VOICE_NOISE_MARGIN = 2.5;

/** The speech bar for a room whose quiet measures `noiseFloor`. */
export function speechThreshold(noiseFloor: number): number {
  return Math.max(VOICE_SPEECH_LEVEL, noiseFloor * VOICE_NOISE_MARGIN);
}
/** Quiet this long after speech ends the turn: a pause, not a comma. */
export const VOICE_END_SILENCE_MS = 1300;
/** Speech shorter than this is a cough or a click, not a turn. */
export const VOICE_MIN_SPEECH_MS = 400;
/** Nobody talks for this long in one breath; send what there is. */
export const VOICE_MAX_TURN_MS = 45_000;
/** Silence this long with no speech at all: stop listening and say so. */
export const VOICE_IDLE_MS = 20_000;

export type VoiceTurnState = {
  startedAt: number;
  /** First and last moments the level crossed VOICE_SPEECH_LEVEL. */
  speechStart: number | null;
  lastSpeech: number | null;
};

export type VoiceTurnDecision = "continue" | "send" | "discard" | "idle";

export function newVoiceTurn(now: number): VoiceTurnState {
  return { startedAt: now, speechStart: null, lastSpeech: null };
}

/** Fold one level sample into the turn. Returns a new state (no mutation). */
export function sampleVoiceTurn(
  s: VoiceTurnState,
  level: number,
  now: number,
  threshold = VOICE_SPEECH_LEVEL,
): VoiceTurnState {
  if (level < threshold) return s;
  return { ...s, speechStart: s.speechStart ?? now, lastSpeech: now };
}

export function decideVoiceTurn(s: VoiceTurnState, now: number): VoiceTurnDecision {
  if (s.speechStart === null || s.lastSpeech === null) {
    return now - s.startedAt >= VOICE_IDLE_MS ? "idle" : "continue";
  }
  const spoke = s.lastSpeech - s.speechStart;
  if (now - s.startedAt >= VOICE_MAX_TURN_MS) {
    return spoke >= VOICE_MIN_SPEECH_MS ? "send" : "discard";
  }
  if (now - s.lastSpeech < VOICE_END_SILENCE_MS) return "continue";
  return spoke >= VOICE_MIN_SPEECH_MS ? "send" : "discard";
}
