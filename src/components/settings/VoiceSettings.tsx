"use client";

import { useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import type { UserPreferencesData } from "@/db/queries/user-preferences";
import { TOAST_SHORT_MS } from "@/lib/constants/timings";
import { Segmented } from "@/components/ui/segmented";

// Quick-start voices — fill the textarea, then the user tunes from there.
// These are starting points, not an enum; the field is free text.
const PRESETS: { label: string; value: string }[] = [
  {
    label: "Concise & direct",
    value: "Concise and direct. Lead with the answer, skip preamble, no filler.",
  },
  {
    label: "Warm & encouraging",
    value: "Warm and encouraging. Friendly, supportive, plain language.",
  },
  {
    label: "Technical & precise",
    value: "Technical and precise. Name specifics, define terms, no hand-waving.",
  },
  {
    label: "Dry & declarative",
    value: "Dry and declarative. State the mechanism, then the consequence. No hype, no hedging.",
  },
];

const MAX = 600;

type Props = { initialPrefs: UserPreferencesData };

export function VoiceSettings({ initialPrefs }: Props) {
  const [saved, setSaved] = useState(initialPrefs.writingVoice ?? "");
  const [voice, setVoice] = useState(initialPrefs.writingVoice ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const dirty = voice.trim() !== (saved ?? "").trim();

  const save = async () => {
    setSaving(true);
    setError("");
    setOk(false);
    try {
      const next = voice.trim() || null;
      const res = await patchJson("/api/me/preferences", { writingVoice: next });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? "Failed to save");
        return;
      }
      setSaved(next ?? "");
      setOk(true);
      setTimeout(() => setOk(false), TOAST_SHORT_MS);
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-settings-section">
      <h2 className="font-medium text-text-primary">Voice</h2>
      <p className="text-sm text-text-secondary -mt-1">
        How AI writes for you. This instruction layers on top of the house style and shapes
        Loki&apos;s replies. Agents you dispatch do not read it. Leave it blank to use the default
        voice.
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-text-muted shrink-0" />
          <h3 className="text-sm font-medium text-text-primary">Writing voice</h3>
        </div>

        <Segmented
          label="Start from a voice"
          columns={2}
          options={PRESETS.map((p) => ({ id: p.label, label: p.label }))}
          value={PRESETS.find((p) => p.value === voice)?.label ?? null}
          onChange={(id) => setVoice(PRESETS.find((p) => p.label === id)?.value ?? voice)}
        />

        <div className="space-y-1.5">
          <textarea
            value={voice}
            onChange={(e) => setVoice(e.target.value.slice(0, MAX))}
            rows={4}
            className="ui-input"
            placeholder="e.g. Concise and direct. Lead with the answer, no preamble. Plain language, no jargon."
          />
          <p className="ui-kicker text-right">
            {voice.length}/{MAX}
          </p>
        </div>

        {error && <p className="ui-error-xs">{error}</p>}
        {ok && <p className="text-sm text-status-positive">Saved.</p>}
        <button onClick={save} disabled={saving || !dirty} className="ui-btn-primary">
          {saving && <Loader2 className="ui-spinner" />}
          Save voice
        </button>
      </div>
    </section>
  );
}
