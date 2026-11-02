/**
 * Notices as voice notes — the owner asked for it, and it costs money (the
 * studio voice is a paid model call), so it is built like any paid feature:
 * an account on a paid plan hears it; a free account gets the text, and once
 * a month one actionable message saying what voice notes cost and where to
 * turn them on. The owner may never pay; the path is ready for those who do.
 */
import { spawn } from "node:child_process";
import { SERVER_VOICES, isSpeechConfigured, synthesizeSpeech } from "@/lib/voice/tts";
import { orangeCatPayUrl, paymentsOpen } from "@/lib/oc-pay";
import type { NoticeRequest } from "@/lib/notify/policy";

/** Studio voice reads at most this much; the rest is in the caption. */
export const VOICE_MAX_CHARS = 600;

export type VoiceNote = { audio?: Buffer; pitch?: boolean };

/** Plans that include voice notes. */
export function planHasVoice(plan: string): boolean {
  return plan !== "free";
}

export async function voiceNoteFor(text: string, plan: string): Promise<VoiceNote> {
  if (!planHasVoice(plan)) return { pitch: true };
  if (!isSpeechConfigured()) return {};
  try {
    const wav = await synthesizeSpeech(text.slice(0, VOICE_MAX_CHARS), SERVER_VOICES[0]);
    const ogg = await wavToOggOpus(Buffer.from(wav));
    return ogg ? { audio: ogg } : {};
  } catch {
    return {};
  }
}

/**
 * Telegram draws a voice bubble only for OGG/Opus. ffmpeg is on the box (the
 * transcription fallback uses it); without it, no voice note — never a broken one.
 */
export function wavToOggOpus(wav: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-f",
        "ogg",
        "pipe:1",
      ]);
    } catch {
      resolve(null);
      return;
    }
    const out: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    proc.stdin.on("error", () => undefined);
    proc.stdin.end(wav);
  });
}

/** The once-a-month "voice notes are a paid feature" message, with its one button. */
export function voicePitch(appUrl: string, now = new Date()): NoticeRequest {
  const pay = paymentsOpen() ? orangeCatPayUrl("personal") : null;
  return {
    source: "loki",
    title: "Hear these as voice notes",
    body: "Voice notes use a paid voice model. They come with the Personal plan; until then you get the text.",
    actions: [
      { label: pay ? "Get Personal" : "See plans", url: pay ?? `${appUrl}/settings#billing` },
    ],
    urgency: "today",
    key: `voice-pitch:${now.toISOString().slice(0, 7)}`,
    once: true,
  };
}
