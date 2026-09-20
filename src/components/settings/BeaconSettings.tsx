"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getJson, patchJson, throwApiError } from "@/lib/api/fetch";
import type { BeaconSettingsData } from "@/db/queries/beacon-settings";
import {
  DEFAULT_BEACON_COUNTDOWN_S,
  MIN_BEACON_COUNTDOWN_S,
  MAX_BEACON_COUNTDOWN_S,
  DEFAULT_AUTO_INJECT_MODE,
} from "@/lib/constants/control";
import {
  WHISPER_MODELS,
  TRANSCRIPTION_PROVIDERS,
  AUTO_INJECT_MODES,
  type AutoInjectMode,
} from "@/config/beacon";
import { LOKI_REFRESH_EVENT } from "@/lib/client-events";

export function BeaconSettings() {
  const [data, setData] = useState<BeaconSettingsData | null>(null);
  const [countdown, setCountdown] = useState(DEFAULT_BEACON_COUNTDOWN_S);
  const [model, setModel] = useState("base");
  const [provider, setProvider] = useState("auto");
  const [autoInjectMode, setAutoInjectMode] = useState<AutoInjectMode>(DEFAULT_AUTO_INJECT_MODE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getJson<BeaconSettingsData>("/api/beacon-settings")
      .then((d) => {
        setData(d);
        setCountdown(d.countdown_seconds);
        setModel(d.whisper_model);
        setProvider(d.transcription_provider);
        setAutoInjectMode(d.auto_inject_mode);
      })
      .catch(() => setLoadError(true));
  }, []);

  const dirty =
    data !== null &&
    (countdown !== data.countdown_seconds ||
      model !== data.whisper_model ||
      provider !== data.transcription_provider ||
      autoInjectMode !== data.auto_inject_mode);

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await patchJson("/api/beacon-settings", {
        countdown_seconds: countdown,
        whisper_model: model,
        transcription_provider: provider,
        auto_inject_mode: autoInjectMode,
      });
      if (!res.ok) await throwApiError(res, "Failed to save");
      setData({
        countdown_seconds: countdown,
        whisper_model: model,
        transcription_provider: provider,
        auto_inject_mode: autoInjectMode,
      });
      setSaved(true);
      window.dispatchEvent(new CustomEvent(LOKI_REFRESH_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-settings-section">
      <div>
        <h2 className="font-medium text-text-primary">Beacon</h2>
        <p className="mt-1 text-sm text-text-tertiary">
          Controls the popup and auto-continue behavior when an agent finishes a task. Settings are
          stored per account and apply across all your sessions.
        </p>
      </div>

      {loadError ? (
        <p className="ui-error">
          Failed to load beacon settings — check that the server is reachable and try reloading.
        </p>
      ) : data === null ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="ui-spinner" /> Loading…
        </div>
      ) : (
        <div className="space-y-8">
          {/* ─── Subgroup: Autopilot behavior ─── */}
          <div className="space-y-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Autopilot
            </h3>

            {/* ── Autopilot mode ── */}
            <div className="space-y-2">
              <label className="ui-kicker">Autopilot mode</label>
              <div className="grid grid-cols-2 gap-2">
                {AUTO_INJECT_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setAutoInjectMode(m.value)}
                    className={[
                      "text-left rounded-lg border p-3 transition-colors",
                      autoInjectMode === m.value
                        ? "border-accent-primary bg-accent-muted"
                        : "border-border-default bg-surface-base hover:border-border-interactive",
                    ].join(" ")}
                  >
                    <div className="font-medium text-sm text-text-primary">{m.label}</div>
                    <div className="mt-1 text-xs text-text-tertiary">{m.description}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted">
                When an agent finishes a task, autopilot sends the next queued instruction — or, if
                the queue is empty, picks the next-best task automatically. It pauses on its own for
                busy agents, pending blockers, and failing health checks. Set it Off to dispatch
                every prompt by hand.{" "}
                <span className="text-text-tertiary">
                  This is the account-wide default. A project that sets its own autopilot on{" "}
                  <a href="/control" className="ui-link">
                    Control
                  </a>{" "}
                  overrides it.
                </span>
              </p>
            </div>

            {/* ── Countdown ── */}
            <div className="space-y-1.5">
              <label className="ui-kicker">Auto-continue countdown</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_BEACON_COUNTDOWN_S}
                  max={MAX_BEACON_COUNTDOWN_S}
                  value={countdown}
                  onChange={(e) =>
                    setCountdown(
                      Math.max(
                        MIN_BEACON_COUNTDOWN_S,
                        Math.min(
                          MAX_BEACON_COUNTDOWN_S,
                          parseInt(e.target.value) || DEFAULT_BEACON_COUNTDOWN_S,
                        ),
                      ),
                    )
                  }
                  className="ui-input w-24 tabular-nums"
                />
                <span className="text-sm text-text-tertiary">seconds</span>
              </div>
              <p className="text-xs text-text-muted">
                How long the &ldquo;Agent finished&rdquo; banner on Control waits before sending the
                next queued instruction. Currently {countdown}s.
              </p>
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* ─── Subgroup: Voice transcription ─── */}
          <div className="space-y-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Voice transcription
            </h3>

            {/* ── Transcription provider ── */}
            <div className="space-y-1.5">
              <label className="ui-kicker">Transcription provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="ui-input"
              >
                {TRANSCRIPTION_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} — {p.note}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted">
                Force local Whisper when Groq is rate-limited, or force Groq when local runtime is
                unavailable.
              </p>
            </div>

            {/* ── Whisper model ── */}
            <div className="space-y-1.5">
              <label className="ui-kicker">Voice transcription model</label>
              <select value={model} onChange={(e) => setModel(e.target.value)} className="ui-input">
                {WHISPER_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label} — {m.note}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted">
                Whisper model used when provider is Local, or Auto with a server runtime available.
                Larger models are more accurate but slower. Downloaded on the server and cached in{" "}
                <code className="text-text-secondary">~/.cache/huggingface/</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && <p className="ui-error">{error}</p>}
      {saved && <p className="text-sm text-status-positive">Saved.</p>}

      <button onClick={save} disabled={saving || !dirty} className="ui-btn-primary">
        {saving && <Loader2 className="ui-spinner" />}
        Save changes
      </button>
    </section>
  );
}
