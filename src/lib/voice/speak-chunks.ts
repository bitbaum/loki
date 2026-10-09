/**
 * A studio voice reads short pieces best, and the vendor asks for about 200
 * characters a request. A briefing is longer, so it is cut at sentence ends,
 * then at clause ends, then — only if a single clause is still too long —
 * at a word boundary. Pieces are fetched one ahead of the one playing, so
 * the cuts are not heard as pauses. Pure; pinned by voice-soundscape.ts.
 */
import { NO_SCREEN_TTS_MAX_CHARS } from "@/config/no-screen";

const SENTENCE_END = /(?<=[.!?])\s+/;
const CLAUSE_END = /(?<=[,;:])\s+/;

function splitHard(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur = `${cur} ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function pack(parts: string[], max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!cur) cur = p;
    else if (cur.length + 1 + p.length <= max) cur = `${cur} ${p}`;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function splitForSpeech(text: string, max = NO_SCREEN_TTS_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const sentences = clean.split(SENTENCE_END).flatMap((s) => {
    if (s.length <= max) return [s];
    const clauses = s.split(CLAUSE_END).flatMap((c) => (c.length <= max ? [c] : splitHard(c, max)));
    return pack(clauses, max);
  });
  return pack(sentences, max);
}
