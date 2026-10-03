/**
 * SSOT for "turn an audio blob into text via Groq Whisper".
 *
 * Lifted out of app/api/beacon/transcribe/route.ts when the public feedback
 * widget needed the same step. Two callers with two copies of the error
 * mapping would drift the moment one of them learned something about a Groq
 * failure mode the other did not.
 *
 * This module owns ONLY the Groq attempt. The local-Whisper fallback stays in
 * the beacon route: it spawns ffmpeg + python3 on whatever host serves the
 * request, which is a reasonable thing to do for an authenticated operator and
 * an unreasonable thing to expose to anonymous public traffic.
 *
 * ── Long recordings ──────────────────────────────────────────────────────────
 * A mic take is a few hundred KB. A voice memo from a phone's recorder is not:
 * the stock Android recorder writes ~1 MB per minute of AAC, so an hour is
 * 60 MB, and Groq refuses anything over ~25 MB. Those files used to be
 * un-transcribable here — the composer filtered them out, and a route that
 * got one answered 413. Now a recording over the upload cap is DOWNMIXED to
 * 16 kHz mono Opus (speech needs nothing more; ~11 MB an hour) and, if still
 * over the cap, SPLIT into segments transcribed in order. Both steps need
 * ffmpeg on this host — the box has it for the local-Whisper fallback — and
 * only run past the cap, so the widget's 3 MB clips never reach them.
 */
import { execFile } from "child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { callGroqTranscribe } from "@/lib/groq";

const execFileAsync = promisify(execFile);

/**
 * Tagged result rather than throw/catch, so a caller can tell a failure it
 * should retry elsewhere (bad key, rate limit, network) from one where the
 * audio itself is the problem and retrying anywhere is pointless.
 */
export type TranscribeAttempt =
  | { ok: true; text: string }
  | { ok: false; recoverable: boolean; status: number; error: string; detail?: string };

/** Below this, the blob cannot contain speech — usually a click-and-release. */
const MIN_AUDIO_BYTES = 100;

/** Groq's documented request limit is 25 MB; stay a little under it. */
export const GROQ_UPLOAD_CAP_BYTES = 24 * 1024 * 1024;

/** 16 kHz mono Opus at this bitrate is ~11 MB an hour and transcribes as
 *  well as the original: Whisper resamples to 16 kHz mono itself. */
const DOWNMIX_BITRATE = "24k";
const DOWNMIX_SAMPLE_RATE = "16000";

/** Segment length once a downmixed recording still exceeds the cap. Twenty
 *  minutes at 24 kbps is ~3.6 MB — well under the cap, with few enough cuts
 *  that a two-hour meeting is six calls, not sixty. */
export const SEGMENT_SECONDS = 20 * 60;

/** A two-hour segment set is not a 30-second request. */
const LONG_CALL_TIMEOUT_MS = 180_000;
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

/** Pure: how a recording of `bytes` reaches Whisper. Tested without ffmpeg. */
export function planUpload(bytes: number, cap = GROQ_UPLOAD_CAP_BYTES): "direct" | "downmix" {
  return bytes > cap ? "downmix" : "direct";
}

/** Pure: the segments a downmixed recording is cut into, 1 when it fits. */
export function segmentCount(
  downmixedBytes: number,
  durationSeconds: number,
  cap = GROQ_UPLOAD_CAP_BYTES,
  segmentSeconds = SEGMENT_SECONDS,
): number {
  if (downmixedBytes <= cap) return 1;
  return Math.max(2, Math.ceil(durationSeconds / segmentSeconds));
}

/** Join segment transcripts: a paragraph break between cuts, never a word
 *  glued to the next segment's first word. */
export function joinSegments(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

function groqFailure(err: unknown): TranscribeAttempt {
  const msg = err instanceof Error ? err.message : String(err);
  if (/groq transcribe 401/i.test(msg) || /invalid.*api.*key/i.test(msg)) {
    return {
      ok: false,
      recoverable: true,
      status: 502,
      error:
        "Groq API key invalid — rotate it at https://console.groq.com and update GROQ_API_KEY.",
      detail: msg,
    };
  }
  if (/groq transcribe 429/i.test(msg) || /rate.?limit/i.test(msg) || /quota/i.test(msg)) {
    return {
      ok: false,
      recoverable: true,
      status: 429,
      error: "Groq rate-limited or over quota.",
      detail: msg,
    };
  }
  if (/abort|timeout/i.test(msg)) {
    return {
      ok: false,
      recoverable: true,
      status: 504,
      error: "Groq transcription timed out.",
      detail: msg,
    };
  }
  return { ok: false, recoverable: true, status: 502, error: msg };
}

async function groqOnce(buf: Buffer, mimeType: string, timeoutMs?: number): Promise<string> {
  const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
  return callGroqTranscribe(blob, mimeType, timeoutMs);
}

/**
 * Downmix a long recording to 16 kHz mono Opus, split it if it is still over
 * the cap, and transcribe the pieces in order. Any ffmpeg failure is final
 * (413): the file is the same size on every path, so no fallback helps.
 */
async function transcribeLong(buf: Buffer): Promise<TranscribeAttempt> {
  const dir = await mkdtemp(join(tmpdir(), "loki-memo-"));
  try {
    const input = join(dir, "input");
    const mixed = join(dir, "mixed.ogg");
    await writeFile(input, buf);
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-nostdin",
          "-loglevel",
          "error",
          "-err_detect",
          "ignore_err",
          "-i",
          input,
          "-vn",
          "-ac",
          "1",
          "-ar",
          DOWNMIX_SAMPLE_RATE,
          "-c:a",
          "libopus",
          "-b:a",
          DOWNMIX_BITRATE,
          "-application",
          "voip",
          "-f",
          "ogg",
          "-y",
          mixed,
        ],
        { timeout: FFMPEG_TIMEOUT_MS, encoding: "utf-8" },
      );
    } catch (err) {
      const e = err as Error & { code?: string; stderr?: string };
      const missing = e.code === "ENOENT";
      return {
        ok: false,
        recoverable: false,
        status: missing ? 503 : 422,
        error: missing
          ? "This recording is too large to send directly and this server cannot compress it (no ffmpeg)."
          : "Could not decode this recording — the file may be corrupt or not audio.",
        detail: e.stderr?.trim() || e.message,
      };
    }

    const mixedBuf = await readFile(mixed);
    if (mixedBuf.length <= GROQ_UPLOAD_CAP_BYTES) {
      try {
        const text = await groqOnce(mixedBuf, "audio/ogg", LONG_CALL_TIMEOUT_MS);
        return text
          ? { ok: true, text }
          : { ok: false, recoverable: false, status: 422, error: "No speech detected" };
      } catch (err) {
        return groqFailure(err);
      }
    }

    // Still over the cap: cut on the downmixed stream (a copy, so the cuts
    // cost nothing) and transcribe in order.
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-nostdin",
          "-loglevel",
          "error",
          "-i",
          mixed,
          "-f",
          "segment",
          "-segment_time",
          String(SEGMENT_SECONDS),
          "-c",
          "copy",
          "-y",
          join(dir, "seg%04d.ogg"),
        ],
        { timeout: FFMPEG_TIMEOUT_MS, encoding: "utf-8" },
      );
    } catch (err) {
      const e = err as Error & { stderr?: string };
      return {
        ok: false,
        recoverable: false,
        status: 422,
        error: "Could not split this recording for transcription.",
        detail: e.stderr?.trim() || e.message,
      };
    }
    const segments = (await readdir(dir)).filter((f) => f.startsWith("seg")).sort();
    const parts: string[] = [];
    for (const seg of segments) {
      try {
        parts.push(
          await groqOnce(await readFile(join(dir, seg)), "audio/ogg", LONG_CALL_TIMEOUT_MS),
        );
      } catch (err) {
        // A segment that failed midway loses the whole take: a transcript
        // with a silent twenty minutes in it would read as if nothing was
        // said there, which is worse than saying it did not work.
        return groqFailure(err);
      }
    }
    const text = joinSegments(parts);
    return text
      ? { ok: true, text }
      : { ok: false, recoverable: false, status: 422, error: "No speech detected" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function transcribeWithGroq(audio: File): Promise<TranscribeAttempt> {
  const buf = Buffer.from(await audio.arrayBuffer());
  if (buf.length < MIN_AUDIO_BYTES) {
    return { ok: false, recoverable: false, status: 422, error: "Recording too short" };
  }
  const mimeType = audio.type || "audio/webm";
  if (planUpload(buf.length) === "downmix") return transcribeLong(buf);
  try {
    const text = await groqOnce(buf, mimeType);
    if (!text) {
      return { ok: false, recoverable: false, status: 422, error: "No speech detected" };
    }
    return { ok: true, text };
  } catch (err) {
    return groqFailure(err);
  }
}
