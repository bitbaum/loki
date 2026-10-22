"use client";

import { useState } from "react";
import { Brain, Download, KeyRound, Loader2, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { DetailSheet } from "@/components/ui/detail-sheet";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
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
  const done = () => {
    setMode("view");
    refetch();
  };

  return (
    <div className="space-y-6">
      <section className="ui-settings-section">
        <Section title="Private zone">
          <p className="ui-settings-lede">
            Memory, People, Crew, Goals, Habits, Events and Money sit behind a PIN. Once you enter
            it, they stay open for 30 minutes.
          </p>
          <List aria-label="Private zone">
            <ListRow
              icon={configured ? ShieldCheck : ShieldOff}
              title="PIN"
              secondary={
                configured ? (unlocked ? "On · open right now" : "On · locked") : "Not set"
              }
              status={configured ? (unlocked ? "warning" : "positive") : undefined}
            />
            {!configured && (
              <ListRow icon={KeyRound} title="Set a PIN" onClick={() => setMode("set")} chevron />
            )}
            {configured && (
              <ListRow
                icon={KeyRound}
                title="Change PIN"
                onClick={() => setMode("change")}
                chevron
              />
            )}
            {configured && unlocked && (
              <ListRow icon={Lock} title="Lock now" onClick={lock} chevron />
            )}
            {configured && (
              <ListRow
                icon={ShieldOff}
                title="Turn the PIN off"
                onClick={() => setMode("disable")}
                chevron
              />
            )}
          </List>
        </Section>

        {mode === "set" && (
          <DetailSheet title="Set a PIN" onClose={() => setMode("view")}>
            <SetPinForm onCancel={() => setMode("view")} onSuccess={done} />
          </DetailSheet>
        )}
        {mode === "change" && (
          <DetailSheet title="Change PIN" onClose={() => setMode("view")}>
            <ChangePinForm onCancel={() => setMode("view")} onSuccess={done} />
          </DetailSheet>
        )}
        {mode === "disable" && (
          <DetailSheet title="Turn the PIN off" onClose={() => setMode("view")}>
            <DisablePinForm onCancel={() => setMode("view")} onSuccess={done} />
          </DetailSheet>
        )}
      </section>

      <section className="ui-settings-section">
        <Section title="Your data">
          <p className="ui-settings-lede">
            Your private data lives in the same database as your account. It is yours: index it or
            not, take it with you, delete it. Memory is deleted on the Memory page, everything under
            Account → Danger zone.
          </p>
          <MemoryConsentToggle />
          <ExportDataButton />
        </Section>
      </section>
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
      <span className="text-sm text-text-tertiary">{label}</span>
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
    <form onSubmit={submit} className="space-y-3">
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
    <form onSubmit={submit} className="space-y-3">
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
    <form onSubmit={submit} className="space-y-3">
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
    if (!data || saving) return;
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
    <div className="space-y-1">
      <List aria-label="Memory">
        <ListRow
          icon={Brain}
          title="Build memory from my data"
          secondary={
            enabled
              ? "On: Loki indexes your projects and notes"
              : "Off: Loki does not index your projects and notes"
          }
          onClick={toggle}
          label={`Build memory from my data: ${enabled ? "on" : "off"}`}
          trailing={
            saving ? (
              <Loader2 className="ui-spinner-sm" aria-hidden />
            ) : (
              <span className={enabled ? "ui-switch ui-switch-on" : "ui-switch"} aria-hidden />
            )
          }
        />
      </List>
      {error && <p className="ui-error-xs">{error}</p>}
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
    <div className="space-y-1">
      <List aria-label="Your data">
        <ListRow
          icon={exporting ? Loader2 : Download}
          title="Export my data"
          secondary="Everything Loki stores about you, as one file"
          onClick={exportData}
          chevron
        />
      </List>
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}
