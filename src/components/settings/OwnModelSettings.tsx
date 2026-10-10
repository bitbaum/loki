"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Check, ExternalLink, KeyRound, Loader2, Plus } from "lucide-react";
import { byokVendor } from "@bitbaum/ai-kit/byok";
import { ownModelRequest, type OwnModelRow } from "@/lib/own-model-client";
import { OwnModelForm } from "./OwnModelForm";

/**
 * "Power Loki with your own models" — every key the user brought, in the
 * order Loki tries them.
 *
 * One key per provider, as many providers as they like: the list IS their
 * chain. The first row is where a turn starts; when that vendor is down or
 * refuses, the next answers — the same shape as the free chain, on their
 * keys. Add is one paste (OwnModelForm); the model on a stored key can be
 * changed without pasting again; a row can be moved up or removed.
 *
 * Nothing here is ever a wall: with no sealing secret on the server the
 * section says so and Loki keeps using its free models.
 */

type Mode = { kind: "list" } | { kind: "add" } | { kind: "change"; row: OwnModelRow };

type Usage = {
  vendor: string;
  tokensToday: number;
  callsToday: number;
  tokens30d: number;
  calls30d: number;
};
type Billing = Record<string, { billingUrl: string; limit: string }>;

const count = (n: number) => n.toLocaleString("en-CH");

export function OwnModelSettings() {
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [models, setModels] = useState<OwnModelRow[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [billing, setBilling] = useState<Billing>({});
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One line after a save that needs a follow-up (an unfunded key). */
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await ownModelRequest<{
          available: boolean;
          models: OwnModelRow[];
          usage: Usage[];
          billing: Billing;
        }>("/api/settings/model", "GET");
        if (!alive) return;
        setAvailable(data.available);
        setModels(data.models);
        setUsage(data.usage ?? []);
        setBilling(data.billing ?? {});
      } catch {
        if (alive) setError("Couldn't read your model settings just now.");
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function act(run: () => Promise<{ models: OwnModelRow[] }>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await run();
      setModels(data.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const order = models.map((m) => m.vendor);
    [order[index - 1], order[index]] = [order[index]!, order[index - 1]!];
    void act(
      () => ownModelRequest("/api/settings/model", "PATCH", { order }),
      "Couldn't reorder your models.",
    );
  }

  function remove(row: OwnModelRow) {
    void act(
      () => ownModelRequest("/api/settings/model", "DELETE", { vendor: row.vendor }),
      "Couldn't remove that key.",
    );
  }

  const showForm = loaded && available && (mode.kind !== "list" || models.length === 0);

  return (
    <section className="ui-settings-section">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-text-primary">
          <KeyRound className="h-4 w-4 text-accent-text" aria-hidden="true" />
          Power Loki with your own models
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Loki runs on free, shared models with a daily budget. Add a key from any provider and Loki
          thinks with the best model your account can use instead — the daily budget no longer
          applies to your chats, and your provider bills you for what you use. Loki charges nothing
          for it. Add several and Loki tries them in order, so one provider having a bad day never
          stops you.
        </p>
      </div>

      {!loaded && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading your settings
        </p>
      )}

      {loaded && !available && (
        <p className="ui-callout-warning">
          Connecting your own model isn&apos;t switched on for this server yet — Loki keeps using
          its free models.
        </p>
      )}

      {savedNote && (
        <p className="ui-callout-warning" role="status">
          {savedNote}
        </p>
      )}

      {loaded && available && models.length > 0 && (
        <ol className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {models.map((row, index) => (
            <li key={row.vendor} className="flex flex-wrap items-start gap-3 px-3 py-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-status-positive" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary">
                  {byokVendor(row.vendor)?.label ?? row.vendor} ·{" "}
                  <span className="break-all">{row.model}</span>
                </p>
                <p className="text-xs text-text-secondary">
                  {index === 0 ? "Loki starts here · " : `Tried ${ordinal(index + 1)} · `}
                  key {row.keyHint} · checked {new Date(row.verifiedAt).toLocaleDateString()}
                </p>
                <UsageLine usage={usage.find((u) => u.vendor === row.vendor)} />
                {billing[row.vendor] && (
                  <a
                    href={billing[row.vendor]!.billingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent-text underline-offset-2 hover:underline"
                  >
                    Credits and {billing[row.vendor]!.limit} at{" "}
                    {byokVendor(row.vendor)?.label ?? row.vendor}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ui-btn-secondary text-xs"
                  onClick={() => setMode({ kind: "change", row })}
                  disabled={busy}
                >
                  Change model
                </button>
                {index > 0 && (
                  <button
                    type="button"
                    className="ui-btn-ghost text-xs"
                    onClick={() => moveUp(index)}
                    disabled={busy}
                    aria-label={`Try ${byokVendor(row.vendor)?.label ?? row.vendor} earlier`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> Earlier
                  </button>
                )}
                <button
                  type="button"
                  className="ui-btn-ghost text-xs"
                  onClick={() => remove(row)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {loaded && available && models.length > 0 && mode.kind === "list" && (
        <button
          type="button"
          className="ui-btn-secondary text-sm"
          onClick={() => setMode({ kind: "add" })}
          disabled={busy}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add another provider
        </button>
      )}

      {showForm && (
        <div className={models.length > 0 ? "border-t border-border-subtle pt-4" : undefined}>
          {mode.kind === "change" && (
            <p className="mb-3 text-sm text-text-secondary">
              Changing the model on your {byokVendor(mode.row.vendor)?.label ?? mode.row.vendor} key
              ({mode.row.keyHint}).
            </p>
          )}
          <OwnModelForm
            key={mode.kind === "change" ? `change:${mode.row.vendor}` : mode.kind}
            existing={models}
            changeOnly={mode.kind === "change" ? mode.row : null}
            onSaved={(next, note) => {
              setModels(next);
              setMode({ kind: "list" });
              setSavedNote(note);
            }}
            onCancel={models.length > 0 ? () => setMode({ kind: "list" }) : null}
          />
        </div>
      )}

      {error && <p className="ui-error text-sm">{error}</p>}
    </section>
  );
}

/**
 * What this key has cost, counted here beside the vendor's own meter. Tokens
 * and calls, never a currency: Loki does not know the vendor's price list,
 * and a wrong franc is worse than an honest token.
 */
function UsageLine({ usage }: { usage: Usage | undefined }) {
  if (!usage || usage.calls30d === 0) {
    return <p className="text-xs text-text-muted">Not used yet.</p>;
  }
  return (
    <p className="text-xs text-text-muted">
      Today {count(usage.tokensToday)} tokens in {usage.callsToday} call
      {usage.callsToday === 1 ? "" : "s"} · 30 days {count(usage.tokens30d)} tokens in{" "}
      {usage.calls30d} call{usage.calls30d === 1 ? "" : "s"}
    </p>
  );
}

function ordinal(n: number): string {
  return n === 2 ? "second" : n === 3 ? "third" : `${n}th`;
}
