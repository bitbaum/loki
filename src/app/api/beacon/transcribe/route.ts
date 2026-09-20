import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { isRuntimeAvailable } from "@/lib/runtime";
import { transcribeWithGroq, type TranscribeAttempt } from "@/lib/transcribe";
import { getApiUserId } from "@/lib/session";
import { denyDemoInHandler } from "@/lib/demo-guard";
import { getBeaconSettings } from "@/db/queries/beacon-settings";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const execFileAsync = promisify(execFile);

// This route is excluded from the auth matcher (the beacon mic can be public),
// and every call bills the Groq Whisper API or spawns ffmpeg + python3 Whisper.
// Without these guards it is an open cost-drain / CPU-exhaustion vector. Cap the
// upload and rate-limit per IP.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ~10 min of Opus; far above any real clip
const RATE_LIMIT = 20; // transcriptions
const RATE_WINDOW_MS = 60_000; // per minute per IP

// Resolve scripts/transcribe.py for both deployment modes:
//   • `npm run dev`           → cwd = repo root            → scripts/transcribe.py
//   • <app>-app.service       → cwd = .next/standalone     → ../../scripts/transcribe.py
// APP_SCRIPTS_DIR (or legacy COCKPIT_SCRIPTS_DIR) can override.
function resolveTranscribePy(): string {
  const envDir = process.env.APP_SCRIPTS_DIR ?? process.env.COCKPIT_SCRIPTS_DIR;
  const candidates = [
    envDir && join(envDir, "transcribe.py"),
    join(process.cwd(), "scripts/transcribe.py"),
    join(process.cwd(), "..", "..", "scripts/transcribe.py"),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[candidates.length - 1];
}
const TRANSCRIBE_PY = resolveTranscribePy();

async function readTranscriptionSettings(): Promise<{ whisperModel: string; provider: string }> {
  try {
    const userId = await getApiUserId();
    if (userId) {
      const s = await getBeaconSettings(userId);
      return { whisperModel: s.whisper_model, provider: s.transcription_provider };
    }
  } catch {
    /* no auth — use defaults */
  }
  return { whisperModel: "base", provider: "auto" };
}

// ─── Transcription attempt shape ─────────────────────────────────────────────
// The Groq attempt lives in @/lib/transcribe because the public feedback
// widget needs the same step; the local fallback below stays here because it
// spawns processes on this host and must not be reachable anonymously.
// `attemptLocalWhisper` returns the same tagged union so the orchestrator can
// still decide recoverable-vs-final uniformly.
type AttemptResult = TranscribeAttempt;

const attemptGroq = transcribeWithGroq;

// ─── Local Whisper subprocess ────────────────────────────────────────────────
// Runs on whatever next-server handles the request — your Linux box in dev,
// the Hetzner VPS in production. Requires ffmpeg + python3 + transcribe.py +
// a whisper model file. Slower than Groq (5–30s depending on model size and
// CPU) but durable when the cloud is down.
async function attemptLocalWhisper(audio: File, model: string): Promise<AttemptResult> {
  // Enable on any host that actually has Whisper installed. The box is a
  // stateless control plane (RUNTIME_AVAILABLE unset) but still runs
  // ffmpeg + faster-whisper for the self-hosted fallback — opted in via
  // TRANSCRIBE_LOCAL_AVAILABLE so deployments without Whisper don't try + fail.
  const localOk = isRuntimeAvailable() || process.env.TRANSCRIBE_LOCAL_AVAILABLE === "true";
  if (!localOk) {
    return {
      ok: false,
      recoverable: false,
      status: 503,
      error:
        "Local Whisper runtime not available on this server (no ffmpeg / python3 / model). Pick Groq under Settings → Agent, or install Whisper.",
    };
  }
  const webmPath = join(tmpdir(), `beacon-${randomUUID()}.webm`);
  const wavPath = webmPath.replace(".webm", ".wav");
  try {
    const buf = Buffer.from(await audio.arrayBuffer());
    if (buf.length < 100) {
      return { ok: false, recoverable: false, status: 422, error: "Recording too short" };
    }
    await writeFile(webmPath, buf);
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-nostdin",
          "-threads",
          "0",
          "-err_detect",
          "ignore_err",
          "-i",
          webmPath,
          "-f",
          "wav",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-y",
          wavPath,
        ],
        { timeout: 15_000, encoding: "utf-8" },
      );
    } catch {
      return {
        ok: false,
        recoverable: false,
        status: 422,
        error: "Audio decode failed — recording may be too short or corrupt",
      };
    }
    const { stdout } = await execFileAsync("python3", [TRANSCRIBE_PY, wavPath, model], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
    });
    const text = stdout.trim();
    if (!text) {
      return { ok: false, recoverable: false, status: 422, error: "No speech detected" };
    }
    return { ok: true, text };
  } catch (err) {
    type ExecError = Error & { stderr?: string };
    const e = err as ExecError;
    const detail = e.stderr?.trim() || e.message;
    return { ok: false, recoverable: true, status: 500, error: detail };
  } finally {
    await Promise.all([unlink(webmPath).catch(() => {}), unlink(wavPath).catch(() => {})]);
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────
//   provider="auto"  → Groq first; on recoverable failure, fall back to local
//   provider="groq"  → Groq only — no fallback even if local runtime is here
//   provider="local" → local only — never call Groq
//
// Returns either { text } or an HTTP error matching the failing branch's status.
export async function POST(req: NextRequest) {
  if (!checkRateLimit(`transcribe:${getClientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many transcription requests — slow down." },
      { status: 429 },
    );
  }

  // Every call bills Groq Whisper or spawns local Whisper. Matcher-excluded
  // path, so the gate lives here — see DEMO_HANDLER_ENFORCED in config/demo.ts.
  const demoDenied = await denyDemoInHandler(await getApiUserId(), "spend");
  if (demoDenied) return demoDenied;

  const form = await req.formData();
  const audio = form.get("audio") as File | null;
  if (!audio) return NextResponse.json({ error: "No audio" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too large (max 10 MB)." }, { status: 413 });
  }

  const { whisperModel: model, provider } = await readTranscriptionSettings();

  if (provider === "local") {
    const result = await attemptLocalWhisper(audio, model);
    if (result.ok) return NextResponse.json({ text: result.text });
    return NextResponse.json(
      { error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
      { status: result.status },
    );
  }

  const groqResult = await attemptGroq(audio);
  if (groqResult.ok) return NextResponse.json({ text: groqResult.text });

  if (provider === "auto" && groqResult.recoverable) {
    // Groq tripped — try local. Wrap the message so the user knows what just
    // happened (Groq failed, local picked up the slack) instead of seeing
    // mysteriously-different latency for the same button.
    const localResult = await attemptLocalWhisper(audio, model);
    if (localResult.ok) {
      return NextResponse.json({
        text: localResult.text,
        via: "local",
        groqError: groqResult.error,
      });
    }
    // Both paths failed — surface the Groq error (the user's actual default)
    // with the local fallback's status appended so they understand neither
    // worked. Prefer Groq's status as the response code since that was the
    // attempted-first path.
    return NextResponse.json(
      {
        error: `${groqResult.error} Local fallback also failed: ${localResult.error}`,
        detail: groqResult.detail,
      },
      { status: groqResult.status },
    );
  }

  return NextResponse.json(
    {
      error: groqResult.error,
      ...(groqResult.detail ? { detail: groqResult.detail } : {}),
    },
    { status: groqResult.status },
  );
}
