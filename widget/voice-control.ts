/**
 * Speak-your-feedback: the mic button and its recorder, wired to the panel's
 * textarea, counter, send button and single error line.
 *
 * Progressive enhancement: on a browser without MediaRecorder, or on an
 * insecure origin where getUserMedia is undefined, no button is created at
 * all. A control that cannot work is worse than no control — so this returns
 * null and the panel simply has no mic.
 */
import { h, micIcon } from "./dom";
import { createVoiceRecorder, formatElapsed, isVoiceSupported, type VoiceRecorder } from "./voice";

export type VoiceControl = { button: HTMLButtonElement; recorder: VoiceRecorder };

export function createVoiceControl(opts: {
  endpoint: string;
  token: string;
  maxMs: number;
  /** Transcribed text, merged into the composer by the caller. */
  onTranscript(text: string): void;
  /** Errors share the panel's one error line rather than inventing a
   *  second place to look. Cleared on any non-error state, so a
   *  successful retry visibly clears the previous failure. */
  onError(message: string): void;
}): VoiceControl | null {
  if (!isVoiceSupported()) return null;

  const micBtn = h("button", "mic");
  const micLabel = h("span", undefined, "Record");
  micBtn.append(micIcon(), micLabel);
  micBtn.setAttribute("aria-label", "Record your feedback by voice");

  const voice = createVoiceRecorder({
    endpoint: opts.endpoint,
    token: opts.token,
    maxMs: opts.maxMs,
    onTranscript: opts.onTranscript,
    onState: (state, detail) => {
      micBtn.classList.toggle("rec", state === "recording");
      micBtn.classList.toggle("busy", state === "requesting" || state === "transcribing");
      micBtn.disabled = state === "requesting" || state === "transcribing";
      micBtn.replaceChildren();
      if (state === "recording") {
        micBtn.append(
          h("span", "dot"),
          h("span", undefined, `Stop ${formatElapsed(detail?.elapsedMs ?? 0)}`),
        );
        micBtn.setAttribute("aria-label", "Stop recording and transcribe");
      } else if (state === "transcribing") {
        micBtn.append(h("span", undefined, "Transcribing…"));
      } else if (state === "requesting") {
        micBtn.append(h("span", undefined, "Allow mic…"));
      } else {
        micBtn.append(micIcon(), h("span", undefined, "Record"));
        micBtn.setAttribute("aria-label", "Record your feedback by voice");
      }
      opts.onError(state === "error" ? (detail?.error ?? "Microphone failed") : "");
    },
  });

  micBtn.addEventListener("click", () => {
    const s = voice.state();
    if (s === "recording") voice.stop();
    else if (s === "idle" || s === "error") void voice.start();
  });

  return { button: micBtn, recorder: voice };
}
