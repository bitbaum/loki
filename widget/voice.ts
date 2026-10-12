/**
 * Speak-your-feedback for the embed.
 *
 * Typing a bug report on a phone, on someone else's site, is the step where
 * most reports die. Talking is the lower-effort path, so the mic exists to
 * raise the number of reports that get filed at all.
 *
 * Two rules shape this file:
 *
 * 1. The transcript is a DRAFT, never a submission. It lands in the same
 *    textarea the visitor was already using, appended to whatever they had
 *    typed, and they send it themselves. Speech-to-text mishears things; a mic
 *    that auto-sent would file those mistakes under the visitor's name.
 *
 * 2. Absence of support is not an error. Browsers without MediaRecorder or a
 *    secure context simply never see the button — no dead control, no message
 *    explaining a thing they cannot do.
 */

/** Elapsed-time formatting for the recording chip: 0:07, 1:42. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Append a transcript to whatever is already in the box.
 *
 * Dictation happens in bursts — someone records, reads it back, records more —
 * so this appends rather than replaces, and never exceeds the field cap that
 * the ingest schema also enforces. Joins with a single space only when the
 * existing text does not already end in whitespace, so repeated bursts do not
 * accumulate gaps.
 */
export function mergeTranscript(existing: string, incoming: string, maxLen: number): string {
  const add = incoming.trim();
  if (!add) return existing.slice(0, maxLen);
  if (!existing) return add.slice(0, maxLen);
  const joiner = /\s$/.test(existing) ? "" : " ";
  return (existing + joiner + add).slice(0, maxLen);
}

/**
 * MIME type for MediaRecorder. Chrome/Firefox take Opus in WebM; Safari only
 * offers mp4/aac. Returning "" lets MediaRecorder pick its own default rather
 * than throwing on an unsupported explicit type.
 */
export function pickAudioMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  return candidates.find((t) => MR.isTypeSupported(t)) ?? "";
}

/**
 * Whether to offer the mic at all.
 *
 * Three separate ways it can be unavailable, and all three must be checked
 * BEFORE drawing the button — a control that cannot work is worse than no
 * control, because the visitor spends effort discovering that:
 *
 *   1. No MediaRecorder — old browser.
 *   2. getUserMedia undefined — insecure origin, the common case for a
 *      customer testing over plain http.
 *   3. Blocked by the host page's Permissions-Policy. This one is the reason
 *      the function grew: orangecat.ch sends
 *      `permissions-policy: camera=(), microphone=(), geolocation=()`.
 *      `microphone=()` is an EMPTY allowlist — denied for every origin
 *      including the site itself — so getUserMedia rejects with
 *      NotAllowedError and the browser never shows a prompt. Measured there:
 *      permissionState "denied", not "prompt".
 *
 *      Crucially, navigator.mediaDevices.getUserMedia still EXISTS in that
 *      state, so checks 1 and 2 both pass and we happily drew a "Speak"
 *      button that could only ever fail. The visitor then sees "Microphone
 *      permission denied" and cannot fix it — there is nothing to allow.
 *
 * A script cannot override Permissions-Policy; that is the point of it. So
 * the widget's job is to notice and stay quiet, and the site's job is to
 * permit the mic (`microphone=(self)`) if it wants the feature.
 */
export function isVoiceSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return false;
  }
  if (typeof MediaRecorder === "undefined") return false;
  return isMicrophoneAllowedByPolicy();
}

/**
 * Does this document's Permissions-Policy permit the microphone?
 *
 * `document.featurePolicy` is non-standard and absent in some browsers, so an
 * unknown answer is treated as ALLOWED: the alternative is hiding a working
 * mic wherever the introspection API is missing, and a real block still fails
 * loudly at click time with a message the visitor can read.
 */
export function isMicrophoneAllowedByPolicy(): boolean {
  try {
    const fp = (document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } })
      .featurePolicy;
    if (!fp || typeof fp.allowsFeature !== "function") return true;
    return fp.allowsFeature("microphone");
  } catch {
    return true;
  }
}

export type VoiceState = "idle" | "requesting" | "recording" | "transcribing" | "error";

export interface VoiceRecorder {
  start(): Promise<void>;
  stop(): void;
  /** Abandon a recording without transcribing it. */
  cancel(): void;
  state(): VoiceState;
}

export interface VoiceOptions {
  endpoint: string;
  token: string;
  /** Hard cap; the server rejects longer uploads, so stop before spending them. */
  maxMs: number;
  onState: (state: VoiceState, detail?: { error?: string; elapsedMs?: number }) => void;
  onTranscript: (text: string) => void;
}

export function createVoiceRecorder(opts: VoiceOptions): VoiceRecorder {
  let state: VoiceState = "idle";
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let tick: ReturnType<typeof setInterval> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let aborted = false;

  function set(next: VoiceState, detail?: { error?: string; elapsedMs?: number }) {
    state = next;
    opts.onState(next, detail);
  }

  /** Release the mic. Leaving tracks live leaves the browser's recording
   *  indicator on, which reads to a visitor as "this site is still listening". */
  function teardown() {
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    if (capTimer) {
      clearTimeout(capTimer);
      capTimer = null;
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  }

  async function start() {
    if (state === "recording" || state === "requesting") return;
    aborted = false;
    chunks = [];
    set("requesting");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as Error)?.name ?? "";
      // NotAllowedError covers both "denied now" and "denied permanently".
      const msg =
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone permission denied"
          : name === "NotFoundError"
            ? "No microphone found"
            : "Could not start the microphone";
      set("error", { error: msg });
      return;
    }

    const mime = pickAudioMime();
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      teardown();
      set("error", { error: "Recording is not supported in this browser" });
      return;
    }

    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });

    recorder.addEventListener("stop", () => {
      const type = recorder?.mimeType || mime || "audio/webm";
      const collected = chunks;
      teardown();
      if (aborted) {
        set("idle");
        return;
      }
      void upload(new Blob(collected, { type }), type);
    });

    startedAt = Date.now();
    recorder.start();
    set("recording", { elapsedMs: 0 });

    tick = setInterval(() => {
      if (state === "recording") opts.onState("recording", { elapsedMs: Date.now() - startedAt });
    }, 1000);

    // Stop at the cap rather than letting the visitor record an upload the
    // server will refuse — a silent 413 after two minutes of talking is the
    // worst possible outcome here.
    capTimer = setTimeout(() => {
      if (state === "recording") stop();
    }, opts.maxMs);
  }

  function stop() {
    if (recorder && recorder.state !== "inactive") {
      set("transcribing");
      recorder.stop();
    }
  }

  function cancel() {
    aborted = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      teardown();
      set("idle");
    }
  }

  async function upload(blob: Blob, type: string) {
    if (blob.size < 1000) {
      set("error", { error: "That was too short — hold the button and speak" });
      return;
    }
    try {
      opts.onTranscript(await transcribeAudio(opts.endpoint, opts.token, blob, type));
      set("idle");
    } catch (e) {
      set("error", {
        error: e instanceof Error ? e.message : "Could not transcribe that, try again",
      });
    }
  }

  return { start, stop, cancel, state: () => state };
}

/**
 * One take to the widget's transcription endpoint (multipart `audio` + the
 * embed `token`) → its words. Throws a sentence to show. Shared by the
 * recorder above and the shared chat's microphone (widget/chat/).
 */
export async function transcribeAudio(
  endpoint: string,
  token: string,
  blob: Blob,
  type = blob.type,
): Promise<string> {
  const form = new FormData();
  // Extension matters: the provider sniffs it when the container is
  // ambiguous, and a mislabelled clip transcribes as silence.
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", blob, `feedback.${ext}`);
  form.append("token", token);
  let res: Response;
  try {
    res = await fetch(endpoint, { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the server, try again");
  }
  const json = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || !json?.text)
    throw new Error(json?.error || "Could not transcribe that, try again");
  return json.text;
}
