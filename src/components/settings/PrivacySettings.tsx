"use client";

import { useState } from "react";
import { Lock, ShieldCheck, ShieldOff, Download, Loader2 } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { usePrivateZone } from "@/hooks/use-private-zone";
import { postJson, deleteJson, patchJson } from "@/lib/api/fetch";
import { ACCOUNT_EXPORT_FILENAME } from "@/lib/account-export";
import { PIN_MAX_DIGITS } from "@/lib/constants/auth";

type PinStatus = { configured: boolean; unlocked: boolean };

type Mode = "view" | "set" | "change" | "disable";

const PIN_DIGITS_MIN = 4;

/**
 * The submit envelope all three PIN forms share: clear the error, call the
 * endpoint, read `{ ok, error }` back, and turn a thrown fetch into a message
 * instead of a form that silently stops responding. Each form still owns its
 * own fields and its own call — only the envelope was identical three times.
 */
function usePinSubmit(onSuccess: () => void) {
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(call: () => Promise<Response>, whenRefused: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await call();
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setErr(data.error ?? whenRefused);
        return;
      }
      onSuccess();
    } catch {
      setErr("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return { err, setErr, loading, run };
}

/** The two rules Set and Change both enforce. The noun differs; the rules do not. */
function pinProblem(newPin: string, confirm: string, noun: "PIN" | "New PIN"): string | null {
  if (newPin.length < PIN_DIGITS_MIN) return `${noun} must be at least ${PIN_DIGITS_MIN} digits`;
  if (newPin !== confirm) return `${noun}s don't match`;
  return null;
}

function PinFormActions({
  loading,
  onCancel,
  label,
  busyLabel,
  danger = false,
}: {
  loading: boolean;
  onCancel: () => void;
  label: string;
  busyLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={loading}
        className={danger ? "ui-btn-danger" : "ui-btn-primary"}
      >
        {loading ? busyLabel : label}
      </button>
      <button type="button" onClick={onCancel} className="ui-btn-secondary">
        Cancel
      </button>
    </div>
  );
}

export function PrivacySettings() {
  const { data, refetch } = useFetch<PinStatus>("/api/auth/pin");
  const { lock } = usePrivateZone();

  const configured = data?.configured ?? false;
  const unlocked = data?.unlocked ?? false;
  const [mode, setMode] = useState<Mode>("view");

  return (
    <div className="space-y-6">
      <div className="ui-settings-section">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Private zone</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            Memory, People, Crew, Robots, Goals, Habits, Events, and Money sit behind a PIN gate.
            Once you enter the right PIN, the zone stays unlocked for 30 minutes from that moment.
          </p>
        </div>

        <div className="space-y-3">
          <StatusRow
            icon={configured ? ShieldCheck : ShieldOff}
            label="PIN protection"
            value={configured ? "Configured" : "Not set"}
            tone={configured ? "positive" : "neutral"}
          />
          {configured && (
            <StatusRow
              icon={unlocked ? Lock : ShieldCheck}
              label="Status right now"
              value={unlocked ? "Unlocked" : "Locked"}
              tone={unlocked ? "warning" : "positive"}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!configured && (
            <button type="button" onClick={() => setMode("set")} className="ui-btn-primary">
              Set PIN
            </button>
          )}
          {configured && (
            <>
              <button type="button" onClick={() => setMode("change")} className="ui-btn-secondary">
                Change PIN
              </button>
              {unlocked ? (
                <button
                  type="button"
                  onClick={lock}
                  className="ui-btn-secondary inline-flex items-center gap-2"
                >
                  <Lock className="h-4 w-4" />
                  Lock now
                </button>
              ) : null}
              <button type="button" onClick={() => setMode("disable")} className="ui-btn-secondary">
                Disable PIN
              </button>
            </>
          )}
        </div>

        {mode === "set" && (
          <SetPinForm
            onCancel={() => setMode("view")}
            onSuccess={() => {
              setMode("view");
              refetch();
            }}
          />
        )}
        {mode === "change" && (
          <ChangePinForm
            onCancel={() => setMode("view")}
            onSuccess={() => {
              setMode("view");
              refetch();
            }}
          />
        )}
        {mode === "disable" && (
          <DisablePinForm
            onCancel={() => setMode("view")}
            onSuccess={() => {
              setMode("view");
              refetch();
            }}
          />
        )}
      </div>

      <div className="ui-settings-section">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Data</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            Your private data — contacts, goals, habits, events, money, and the derived knowledge
            graph — lives on the same database as your account. It&apos;s yours: index it or not,
            take it with you, delete it (memory on the Memory page, everything under Account →
            Danger zone).
          </p>
        </div>

        <MemoryConsentToggle />

        <ExportDataButton />
      </div>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: "positive" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-status-positive"
      : tone === "warning"
        ? "text-status-warning"
        : "text-text-tertiary";
  return (
    <div className="ui-list-item">
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 shrink-0 ${toneClass}`} />
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
      <span className={`text-sm font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

// ─── Forms — one per action so each can own its validation + state ──────────

function PinInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-caps text-text-muted">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={PIN_MAX_DIGITS}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className="ui-input ui-pin-input w-full text-center text-xl"
      />
    </label>
  );
}

function SetPinForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [newPin, setNewPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const { err, setErr, loading, run } = usePinSubmit(onSuccess);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = pinProblem(newPin, confirm, "PIN");
    if (problem) {
      setErr(problem);
      return;
    }
    await run(() => postJson("/api/auth/pin/setup", { newPin }), "Couldn't set PIN");
  }

  return (
    <form onSubmit={submit} className="ui-settings-subpanel space-y-3">
      <PinInput label="New PIN" value={newPin} onChange={setNewPin} placeholder="••••" autoFocus />
      <PinInput label="Confirm PIN" value={confirm} onChange={setConfirm} placeholder="••••" />
      {err && <p className="ui-error-xs">{err}</p>}
      <PinFormActions loading={loading} onCancel={onCancel} label="Save PIN" busyLabel="Saving…" />
    </form>
  );
}

function ChangePinForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const { err, setErr, loading, run } = usePinSubmit(onSuccess);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = pinProblem(newPin, confirm, "New PIN");
    if (problem) {
      setErr(problem);
      return;
    }
    await run(() => postJson("/api/auth/pin/setup", { currentPin, newPin }), "Couldn't change PIN");
  }

  return (
    <form onSubmit={submit} className="ui-settings-subpanel space-y-3">
      <PinInput
        label="Current PIN"
        value={currentPin}
        onChange={setCurrentPin}
        placeholder="••••"
        autoFocus
      />
      <PinInput label="New PIN" value={newPin} onChange={setNewPin} placeholder="••••" />
      <PinInput label="Confirm new PIN" value={confirm} onChange={setConfirm} placeholder="••••" />
      {err && <p className="ui-error-xs">{err}</p>}
      <PinFormActions
        loading={loading}
        onCancel={onCancel}
        label="Change PIN"
        busyLabel="Saving…"
      />
    </form>
  );
}

function DisablePinForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [currentPin, setCurrentPin] = useState("");
  const { err, loading, run } = usePinSubmit(onSuccess);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => deleteJson("/api/auth/pin/setup", { currentPin }), "Couldn't disable PIN");
  }

  return (
    <form onSubmit={submit} className="ui-settings-subpanel space-y-3">
      <p className="text-sm text-text-secondary">
        Disabling the PIN removes the gate. Your private data stays in place — it just becomes
        accessible without entering a PIN.
      </p>
      <PinInput
        label="Current PIN"
        value={currentPin}
        onChange={setCurrentPin}
        placeholder="••••"
        autoFocus
      />
      {err && <p className="ui-error-xs">{err}</p>}
      <PinFormActions
        loading={loading}
        onCancel={onCancel}
        label="Disable PIN"
        busyLabel="Disabling…"
        danger
      />
    </form>
  );
}

/** "Build fleet memory from my data" — gates knowledge-index writes (upsertKnowledgeBatch). */
function MemoryConsentToggle() {
  const { data, refetch } = useFetch<{ memoryEnabled: boolean }>("/api/me/preferences");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = data?.memoryEnabled !== false;

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await patchJson("/api/me/preferences", { memoryEnabled: !enabled });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-text-primary">Build fleet memory from my data</div>
        <p className="mt-0.5 text-xs text-text-tertiary">
          Off = the fleet stops indexing your projects and notes into the knowledge index (RAG).
          Existing memory stays until you delete it on the Memory page.
        </p>
        {error && <p className="mt-1 text-xs text-status-negative">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Build fleet memory from my data"
        onClick={toggle}
        disabled={saving || !data}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-accent-primary" : "bg-surface-overlay border border-border-subtle"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/** Download everything the platform stores about you as JSON (GDPR right of access). */
function ExportDataButton() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportData = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/export");
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ACCOUNT_EXPORT_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mt-4">
      <button type="button" onClick={exportData} disabled={exporting} className="ui-btn-secondary">
        {exporting ? <Loader2 className="ui-spinner" /> : <Download className="w-4 h-4" />}
        Export my data
      </button>
      {error && <p className="mt-1 text-xs text-status-negative">{error}</p>}
    </div>
  );
}
