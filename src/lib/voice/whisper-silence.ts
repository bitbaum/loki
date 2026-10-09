/**
 * What was actually said in a Whisper result, without the words Whisper
 * invents for silence.
 *
 * Whisper was trained on subtitled video, so a take of breath, room noise or
 * nothing at all comes back as the sentence that ends a video: "Thank you.",
 * "Thanks for watching!", «Bis zum nächsten Mal.» In Loki's voice conversation
 * that invented line was sent as the person's turn and answered, aloud, as if
 * they had said it (operator, 2026-10-09; heidi measured the same on a 1.5 s
 * take).
 *
 * The verbose response carries, per segment, the model's own estimate that
 * there was no speech in it. A segment is dropped when:
 *   - the model is confident there was no speech and unsure of the words — the
 *     rule OpenAI's reference decoder uses (no_speech_prob > 0.6 and
 *     avg_logprob < -1), or
 *   - its whole text is one of the known silence lines and the model had even
 *     a modest doubt there was speech at all. "Thank you." said plainly into a
 *     microphone scores near zero there and is kept.
 *
 * Pure (scripts/test/whisper-silence.ts).
 */

export type WhisperSegment = {
  text?: string;
  no_speech_prob?: number;
  avg_logprob?: number;
};

export type WhisperVerbose = { text?: string; segments?: WhisperSegment[] };

/** Lines Whisper produces from silence, lower-cased, punctuation stripped. */
const SILENCE_LINES = new Set([
  "thank you",
  "thank you very much",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thanks for listening",
  "please subscribe",
  "bye",
  "you",
  "vielen dank",
  "danke",
  "bis zum nächsten mal",
  "untertitel im auftrag des zdf für funk 2017",
  "untertitel der amaraorg-community",
  "merci",
  "merci davoir regardé cette vidéo",
  "sous-titrage st 501",
  "продолжение следует",
  "спасибо",
  "субтитры сделал dimatorzok",
]);

/** Above this, a segment that reads like a silence line is treated as one. */
const SILENCE_LINE_DOUBT = 0.15;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSilenceSegment(s: WhisperSegment): boolean {
  const noSpeech = s.no_speech_prob ?? 0;
  const logprob = s.avg_logprob ?? 0;
  if (noSpeech > 0.6 && logprob < -1) return true;
  return noSpeech > SILENCE_LINE_DOUBT && SILENCE_LINES.has(normalise(s.text ?? ""));
}

/** The spoken words in a verbose Whisper result; "" when nothing was said. */
export function spokenText(data: WhisperVerbose): string {
  if (!Array.isArray(data.segments) || data.segments.length === 0) {
    return (data.text ?? "").trim();
  }
  return data.segments
    .filter((s) => !isSilenceSegment(s))
    .map((s) => (s.text ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}
