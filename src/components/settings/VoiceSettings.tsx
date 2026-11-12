"use client";

import { useState } from "react";
import { Check, Loader2, MessageSquare } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import type { UserPreferencesData } from "@/db/queries/user-preferences";
import { TOAST_SHORT_MS } from "@/lib/constants/timings";

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
      <p className="text-sm text-text-secondary -mt-1">
        How Loki writes to you. Agents building your projects don&apos;t use it. Leave it blank for
        Loki&apos;s normal voice.
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-text-muted shrink-0" />
          <h3 className="text-sm font-medium text-text-primary">Writing voice</h3>
        </div>

        {/* A pick-one list with a check, like the digest choice in
            Notifications — it was a 2×2 wrapped grid of segments. */}
        <div className="-mx-3 flex flex-col" role="radiogroup" aria-label="Start from a voice">
          {PRESETS.map((p) => {
            const active = p.value === voice;
            return (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setVoice(p.value)}
                className="ui-settings-choice"
              >
                <span className="min-w-0 flex-1">
                  <span className="ui-settings-choice-title">{p.label}</span>
                </span>
                {active && <Check className="h-5 w-5 shrink-0 text-text-primary" />}
              </button>
            );
          })}
        </div>

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
