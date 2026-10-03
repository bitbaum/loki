/**
 * A voice memo longer than Groq's request cap still gets transcribed.
 *
 * 2026-10-03: the composer now takes recordings as files (chatkit v0.3.0),
 * and a phone's recorder writes ~1 MB a minute, so an hour is 60 MB against
 * a ~25 MB cap. lib/transcribe downmixes to 16 kHz mono Opus and, if still
 * over, segments. The pure decisions are tested here; the ffmpeg downmix is
 * exercised for real on a synthetic 25 MB WAV where ffmpeg exists, up to the
 * point the Groq call would go out (no key here → a recoverable failure,
 * which proves the pipeline reached it rather than refusing the size).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GROQ_UPLOAD_CAP_BYTES,
  SEGMENT_SECONDS,
  joinSegments,
  planUpload,
  segmentCount,
  transcribeWithGroq,
} from "../../src/lib/transcribe";

const MB = 1024 * 1024;

// Under the cap goes straight out; over it is downmixed first.
assert.equal(planUpload(300_000), "direct");
assert.equal(planUpload(GROQ_UPLOAD_CAP_BYTES), "direct");
assert.equal(planUpload(66 * MB), "downmix", "a 66 MB phone memo is downmixed");
assert.ok(GROQ_UPLOAD_CAP_BYTES < 25 * MB, "stays under Groq's documented 25 MB");

// Downmixed and fitting: one call. Still over: cut into twenty-minute pieces.
assert.equal(segmentCount(11 * MB, 3600), 1, "an hour at 24 kbps is one call");
assert.equal(segmentCount(33 * MB, 3 * 3600), 9, "three hours is nine twenty-minute segments");
assert.ok(segmentCount(30 * MB, 60) >= 2, "over the cap is never a single call");
assert.equal(SEGMENT_SECONDS, 1200);

// Segments join as paragraphs, never one word glued to the next cut's first.
assert.equal(joinSegments(["ein Satz. ", "", "  und noch einer"]), "ein Satz.\n\nund noch einer");
assert.equal(joinSegments(["", "  "]), "");

// The route's cap matches what the composer will send.
const route = readFileSync("src/app/api/beacon/transcribe/route.ts", "utf8");
assert.match(route, /MAX_AUDIO_BYTES = 120 \* 1024 \* 1024/, "route accepts a 120 MB memo");

async function main() {
  // Real ffmpeg, synthetic audio: 800 s of 16 kHz mono PCM is 25.6 MB, over the
  // cap. The downmix must run and hand a small Opus file to the Groq step.
  let ffmpeg = true;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    ffmpeg = false;
  }
  if (ffmpeg) {
    const dir = mkdtempSync(join(tmpdir(), "loki-memo-test-"));
    try {
      const wav = join(dir, "memo.wav");
      execFileSync(
        "ffmpeg",
        [
          "-nostdin",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=800",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-y",
          wav,
        ],
        { stdio: "ignore" },
      );
      const bytes = readFileSync(wav);
      assert.ok(
        bytes.length > GROQ_UPLOAD_CAP_BYTES,
        `synthetic memo is over the cap (${bytes.length})`,
      );
      delete process.env.GROQ_API_KEY;
      const file = new File([new Uint8Array(bytes)], "memo.wav", { type: "audio/wav" });
      const started = Date.now();
      const result = await transcribeWithGroq(file);
      assert.equal(result.ok, false);
      if (result.ok) throw new Error("unreachable");
      // Reached the Groq step (key missing → recoverable), not refused for size
      // and not an ffmpeg failure (which would be final).
      assert.equal(result.recoverable, true, `downmix ran and reached Groq: ${result.error}`);
      assert.match(result.error, /GROQ_API_KEY/);
      console.log(`transcribe-long-recordings: downmix of 25.6 MB in ${Date.now() - started} ms`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    console.log("transcribe-long-recordings: no ffmpeg here — downmix not exercised");
  }
  console.log("transcribe-long-recordings: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
