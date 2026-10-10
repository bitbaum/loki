"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, ExternalLink, KeyRound, Loader2, Plus, Zap } from "lucide-react";
import { CUSTOM_VENDOR_ID, isVendorId, vendorById, type VendorId } from "@/config/model-vendors";
import { MODEL_STORE_PATH } from "@/lib/own-model-path";
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

type Mode =
  | { kind: "list" }
  | { kind: "add"; vendor?: VendorId; model?: string }
  | { kind: "change"; row: OwnModelRow };

/** The store's "Add" and "Use" buttons arrive as ?add=<vendor>&model=<id> (see ownModelAddPath). */
function modeFromUrl(): Mode {
  if (typeof window === "undefined") return { kind: "list" };
  const q = new URLSearchParams(window.location.search);
  const add = q.get("add");
  if (!add || !isVendorId(add)) return { kind: "list" };
  return { kind: "add", vendor: add, model: q.get("model") ?? undefined };
}

type Usage = {
  vendor: string;
  tokensToday: number;
  callsToday: number;
  tokens30d: number;
  calls30d: number;
};
type Billing = Record<string, { billingUrl: string | null; limit: string | null }>;

type TestResult =
  | { state: "running" }
  | { state: "ok"; ms: number; answer: string }
  | { state: "failed"; ms: number; message: string };

const label = (vendor: string) => vendorById(vendor)?.label ?? vendor;

/** "MacBook Ollama" for an endpoint the person named; the vendor's label otherwise. */
const rowName = (row: OwnModelRow) =>
  row.vendor === CUSTOM_VENDOR_ID ? (row.label ?? "Your endpoint") : label(row.vendor);

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

const count = (n: number) => n.toLocaleString("en-CH");

export function OwnModelSettings() {
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [models, setModels] = useState<OwnModelRow[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [billing, setBilling] = useState<Billing>({});
  const [mode, setMode] = useState<Mode>(modeFromUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * One line after every change — added, changed, moved, removed — so the
   * person SEES that what they did took, instead of a list that silently
   * re-rendered (George, 2026-10-10: "some feedback like the model
   * successfully added"). A warning tone when the key still needs something.
   */
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  /** The last real turn per vendor: answered in N s, or what went wrong. */
  const [tests, setTests] = useState<Record<string, TestResult>>({});

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

  async function act(
    run: () => Promise<{ models: OwnModelRow[] }>,
    failure: string,
    done: (models: OwnModelRow[]) => string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const data = await run();
      setModels(data.models);
      setNote({ tone: "ok", text: done(data.models) });
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
      (next) => `Order saved. Loki now starts with ${label(next[0]!.vendor)} · ${next[0]!.model}.`,
    );
  }

  function remove(row: OwnModelRow) {
    setTests((t) => {
      const { [row.vendor]: _gone, ...rest } = t;
      return rest;
    });
    void act(
      () => ownModelRequest("/api/settings/model", "DELETE", { vendor: row.vendor }),
      "Couldn't remove that key.",
      (next) =>
        next.length === 0
          ? `${label(row.vendor)} key removed. Loki is back on its free models.`
          : `${label(row.vendor)} key removed. Loki now starts with ${label(next[0]!.vendor)}.`,
    );
  }

  /** One real, tiny turn on that key: "it answered in 1.3 s" beats "saved". */
  async function test(vendor: string) {
    setTests((t) => ({ ...t, [vendor]: { state: "running" } }));
    try {
      const r = await ownModelRequest<
        { ok: true; ms: number; answer: string } | { ok: false; ms: number; message: string }
      >("/api/settings/model/test", "POST", { vendor });
      setTests((t) => ({
        ...t,
        [vendor]: r.ok
          ? { state: "ok", ms: r.ms, answer: r.answer }
          : { state: "failed", ms: r.ms, message: r.message },
      }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [vendor]: {
          state: "failed",
          ms: 0,
          message: e instanceof Error ? e.message : "Couldn't test.",
        },
      }));
    }
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
          Paste a key from any provider — or point Loki at a model on your own machine — and it
          thinks with the best model your account can use. Your provider bills you for what you use;
          Loki charges nothing and the shared daily budget no longer applies to your chats. Add
          several and Loki tries them in order.{" "}
          <Link
            href={MODEL_STORE_PATH}
            className="text-accent-text underline-offset-2 hover:underline"
          >
            Compare providers and prices →
          </Link>
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

      {note && (
        <p
          className={note.tone === "ok" ? "ui-callout-positive" : "ui-callout-warning"}
          role="status"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{note.text}</span>
        </p>
      )}

      {/* `basis-56` on each row's text block: without a basis the buttons took
          their width first and the text was squeezed into a column a few
          characters wide, wrapping "grok-4.7" letter by letter on a phone
          (2026-10-10). Now the text keeps at least 14rem and the buttons wrap
          under it when the row is narrower than both. */}
      {loaded && available && models.length > 0 && (
        <ol className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {models.map((row, index) => (
            <li key={row.vendor} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-status-positive" aria-hidden="true" />
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-medium text-text-primary">
                  {rowName(row)} · <span className="break-words">{row.model}</span>
                </p>
                <p className="text-xs text-text-secondary">
                  {index === 0 ? "Loki starts here · " : `Tried ${ordinal(index + 1)} · `}
                  {row.vendor === CUSTOM_VENDOR_ID && hostOf(row.baseUrl)
                    ? `${hostOf(row.baseUrl)} · `
                    : ""}
                  key {row.keyHint} · checked {new Date(row.verifiedAt).toLocaleDateString()}
                </p>
                <UsageLine usage={usage.find((u) => u.vendor === row.vendor)} />
                <TestLine result={tests[row.vendor]} />
                {billing[row.vendor]?.billingUrl && (
                  <a
                    href={billing[row.vendor]!.billingUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent-text underline-offset-2 hover:underline"
                  >
                    Credits and {billing[row.vendor]!.limit} at {label(row.vendor)}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  className="ui-btn-secondary text-xs"
                  onClick={() => void test(row.vendor)}
                  disabled={busy || tests[row.vendor]?.state === "running"}
                  title="Send one short question on this key and time the answer"
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Test
                </button>
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
                    aria-label={`Try ${rowName(row)} earlier`}
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
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="ui-btn-secondary text-sm"
            onClick={() => setMode({ kind: "add" })}
            disabled={busy}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add another provider
          </button>
          {models.length === 1 && (
            <p className="text-xs text-text-tertiary">
              One provider is one point of failure. A second gives Auto a choice when this one is
              slow or out of credit — and two models to compare on the same question.
            </p>
          )}
        </div>
      )}

      {showForm && (
        <div className={models.length > 0 ? "border-t border-border-subtle pt-4" : undefined}>
          {mode.kind === "change" && (
            <p className="mb-3 text-sm text-text-secondary">
              Changing the model on {rowName(mode.row)} ({mode.row.keyHint}).
            </p>
          )}
          <OwnModelForm
            key={mode.kind === "change" ? `change:${mode.row.vendor}` : mode.kind}
            existing={models}
            changeOnly={mode.kind === "change" ? mode.row : null}
            initialVendor={mode.kind === "add" ? mode.vendor : undefined}
            initialModel={mode.kind === "add" ? mode.model : undefined}
            onSaved={(next, saved) => {
              setModels(next);
              setMode({ kind: "list" });
              const row = next.find((m) => m.vendor === saved.vendor);
              const name = `${row ? rowName(row) : label(saved.vendor)} · ${row?.model ?? ""}`;
              if (saved.unfunded) {
                setNote({
                  tone: "warn",
                  text: `${name} saved. It answers once the account has credits — see the billing link on its row.`,
                });
                return;
              }
              setNote({
                tone: "ok",
                text:
                  saved.kind === "change"
                    ? `${name} — model changed. Testing it now…`
                    : next[0]?.vendor === saved.vendor
                      ? `${name} added. Loki starts here now. Testing it…`
                      : `${name} added as your ${ordinal(next.findIndex((m) => m.vendor === saved.vendor) + 1)} model. Testing it…`,
              });
              void test(saved.vendor);
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

/** The last real turn on this key: proof it works, with its time. */
function TestLine({ result }: { result: TestResult | undefined }) {
  if (!result) return null;
  if (result.state === "running") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-text-muted" role="status">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Asking it one short
        question…
      </p>
    );
  }
  if (result.state === "ok") {
    return (
      <p className="text-xs text-status-positive" role="status">
        Answered in {(result.ms / 1000).toFixed(1)} s
        {result.answer ? <span className="text-text-secondary"> — “{result.answer}”</span> : null}
      </p>
    );
  }
  return (
    <p className="text-xs text-status-negative" role="status">
      Didn&apos;t answer ({(result.ms / 1000).toFixed(1)} s): {result.message}
    </p>
  );
}

function ordinal(n: number): string {
  return n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`;
}
