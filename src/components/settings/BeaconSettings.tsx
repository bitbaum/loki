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
import {
  NIGHT_ALLOW_CHOICES,
  NIGHT_RUNS_DEFAULT,
  NIGHT_RUNS_MAX,
  STALE_REPORT_DAYS,
  allowanceDaysLeft,
} from "@/config/autopilot-night";

export function BeaconSettings() {
  const [data, setData] = useState<BeaconSettingsData | null>(null);
  const [countdown, setCountdown] = useState(DEFAULT_BEACON_COUNTDOWN_S);
  const [model, setModel] = useState("base");
  const [provider, setProvider] = useState("auto");
  const [autoInjectMode, setAutoInjectMode] = useState<AutoInjectMode>(DEFAULT_AUTO_INJECT_MODE);
  const [nightRuns, setNightRuns] = useState(NIGHT_RUNS_DEFAULT);
  // The allowance is edited as "for how long from now" and stored as an
  // instant; what the owner last set is read back as the choice it rounds to.
  const [allowDays, setAllowDays] = useState(0);
  const [costCap, setCostCap] = useState("");
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
        setNightRuns(d.night_runs);
        setAllowDays(allowanceDaysLeft(d.night_allow_until));
        setCostCap(d.night_cost_cap_usd == null ? "" : String(d.night_cost_cap_usd));
      })
      .catch(() => setLoadError(true));
  }, []);

  const dirty =
    data !== null &&
    (countdown !== data.countdown_seconds ||
      model !== data.whisper_model ||
      provider !== data.transcription_provider ||
      autoInjectMode !== data.auto_inject_mode ||
      nightRuns !== data.night_runs ||
      allowDays !== allowanceDaysLeft(data.night_allow_until) ||
      costCap !== (data.night_cost_cap_usd == null ? "" : String(data.night_cost_cap_usd)));

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
        night_runs: nightRuns,
        night_allow_days: allowDays,
        night_cost_cap_usd: costCap.trim() === "" ? null : Number(costCap),
      });
      if (!res.ok) await throwApiError(res, "Failed to save");
      setData({
        countdown_seconds: countdown,
        whisper_model: model,
        transcription_provider: provider,
        auto_inject_mode: autoInjectMode,
        night_runs: nightRuns,
        night_allow_until:
          allowDays > 0 ? new Date(Date.now() + allowDays * 86_400_000).toISOString() : null,
        night_cost_cap_usd: costCap.trim() === "" ? null : Number(costCap),
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
        <h2 className="font-medium text-text-primary">When an agent finishes</h2>
        <p className="mt-1 text-sm text-text-tertiary">
          What Loki does when an agent reports it is done, and how your voice becomes text. Stored
          per account and applied across all your sessions.
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
                When an agent finishes a task, autopilot sends the next queued instruction. It
                pauses on its own for busy agents, pending blockers, and failing health checks. Set
                it Off to dispatch every prompt by hand.{" "}
                <span className="text-text-tertiary">
                  This is the account-wide default. A project that sets its own autopilot on{" "}
                  <a href="/control" className="ui-link">
                    Control
                  </a>{" "}
                  overrides it.
                </span>
              </p>
            </div>

            {/* ── The night's budget ── */}
            <div className="space-y-1.5">
              <label className="ui-kicker" htmlFor="night-runs">
                Overnight
              </label>
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-tertiary">up to</span>
                <input
                  id="night-runs"
                  type="number"
                  min={0}
                  max={NIGHT_RUNS_MAX}
                  value={nightRuns}
                  onChange={(e) =>
                    setNightRuns(
                      Math.max(0, Math.min(NIGHT_RUNS_MAX, parseInt(e.target.value) || 0)),
                    )
                  }
                  className="ui-input w-24 tabular-nums"
                />
                <span className="text-sm text-text-tertiary">runs a night</span>
              </div>
              <p className="text-xs text-text-muted">
                While you sleep, Loki works through your feedback — one fix per project, the
                owner&apos;s own notes first — and reads one site that has not been read this week,
                filing what it finds into Feedback. Every run is an agent run on your builder, so
                this number is the most it can spend. It also files away reports nobody started in{" "}
                {STALE_REPORT_DAYS} days, with the reason on the row. 0 keeps the filing and stops
                the building. A project paused on Control is left alone.
              </p>
            </div>

            {/* ── The night asks first ── */}
            <div className="space-y-1.5">
              <label className="ui-kicker" htmlFor="night-allow">
                Nights run without asking
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <select
                  id="night-allow"
                  value={allowDays}
                  onChange={(e) => setAllowDays(Number(e.target.value))}
                  className="ui-input w-auto"
                >
                  {NIGHT_ALLOW_CHOICES.map((c) => (
                    <option key={c.days} value={c.days}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-text-tertiary">up to $</span>
                  <input
                    id="night-cap"
                    type="number"
                    min={0}
                    step="0.5"
                    inputMode="decimal"
                    placeholder="no cap"
                    value={costCap}
                    onChange={(e) => setCostCap(e.target.value)}
                    className="ui-input w-24 tabular-nums"
                    aria-label="Cost cap per night in dollars"
                  />
                  <span className="text-sm text-text-tertiary">a night</span>
                </div>
              </div>
              <p className="text-xs text-text-muted">
                Every evening Loki shows you tonight&apos;s plan — which fixes, which site, and what
                it would cost from your own last runs — and nothing that spends is started without
                your yes. Set an allowance and it runs without asking for that long, under the cap;
                a night over the cap asks again. Filing away old reports and moving stuck rows to
                the cloud is free and always happens. Building uses your builder as set above; the
                evening message and the morning note cost nothing.
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
