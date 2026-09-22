export const WHISPER_MODEL_VALUES = ["tiny", "base", "small", "medium", "large"] as const;
type WhisperModel = (typeof WHISPER_MODEL_VALUES)[number];

export const WHISPER_MODELS: readonly { value: WhisperModel; label: string; note: string }[] = [
  // No download sizes here on purpose. The figures that used to sit in these
  // notes (39/74/244/769 MB, 1.5 GB) are openai-whisper .pt sizes, but
  // scripts/transcribe.py uses faster-whisper, which fetches CT2 builds that
  // are roughly twice as large — measured 2026-09-22: tiny 75 MB, small
  // 464 MB. Only those two were ever downloaded, so three of the five numbers
  // could not be corrected, only guessed. Ordering is the honest signal.
  { value: "tiny", label: "Tiny", note: "fastest, lowest accuracy" },
  { value: "base", label: "Base", note: "good balance (default)" },
  { value: "small", label: "Small", note: "better accuracy" },
  { value: "medium", label: "Medium", note: "high accuracy, slower" },
  { value: "large", label: "Large", note: "best accuracy, slowest" },
];

export const TRANSCRIPTION_PROVIDER_VALUES = ["auto", "local", "groq"] as const;
type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDER_VALUES)[number];

export const TRANSCRIPTION_PROVIDERS: readonly {
  value: TranscriptionProvider;
  label: string;
  note: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    note: "Groq first (~2s, free), local Whisper as fallback on auth/quota/timeout",
  },
  {
    value: "groq",
    label: "Groq cloud",
    note: "whisper-large-v3-turbo via API — rate limited, no fallback",
  },
  {
    value: "local",
    label: "Local Whisper",
    note: "the server's Whisper runtime — no Groq attempt",
  },
];

// Autopilot is binary. After the 2026-06-11 collapse (killing-the-bash-daemon
// migration, Session 3), the five-tier ladder (off/queue_only/beacon/
// next_best/strategist) is replaced by off|on. Most users only ever used "off"
// or "fire-when-done"; the intermediate tiers were cognitive load without
// proportionate value. Safety rails (status:working, blockers, no-op counter,
// health gates) still apply at every level — being "on" doesn't override the
// agent's "I'm not done" signal.
export const AUTO_INJECT_MODE_VALUES = ["off", "on"] as const;
export type AutoInjectMode = (typeof AUTO_INJECT_MODE_VALUES)[number];

export const AUTO_INJECT_MODES: readonly {
  value: AutoInjectMode;
  label: string;
  description: string;
}[] = [
  {
    value: "off",
    label: "Off",
    description: "Loki dispatches nothing. You type every prompt in /control and click Send.",
  },
  {
    value: "on",
    label: "On",
    description:
      "When an agent finishes, Loki sends the next queued instruction — or, if the queue is empty, picks the next-best task. Busy agents, blockers, and failing health checks still pause dispatch.",
  },
];

/** Map any value (current or legacy) to the new 2-state space. Off stays off;
 *  every other historical mode collapses to "on" because they all auto-fired
 *  in some way. Use this when reading an old DB row or env var that hasn't
 *  been migrated yet. */
export function normalizeAutoInjectMode(raw: string | null | undefined): AutoInjectMode {
  if (raw === "off") return "off";
  return "on";
}
