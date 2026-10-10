"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, X } from "lucide-react";
import { BYOK_VENDORS, byokVendor, type ByokVendorId } from "@bitbaum/ai-kit/byok";
import { ownModelRequest, type OwnModelRow } from "@/lib/own-model-client";

/**
 * The one form behind "Add a key" and "Change model" in Settings → AI.
 *
 * Built so that connecting a model takes one paste: pick a provider, open its
 * key page, paste, and the key is checked on the spot. If it works, the models
 * it can actually use appear with the strongest one already chosen (ai-kit's
 * probe reads the vendor's own list — it never guesses names). One click saves.
 *
 * Every state says what it means for the reader, including the two failure
 * shapes that must not be confused: the vendor REFUSED the key (their words,
 * shown), versus we COULD NOT CHECK it (a vendor hiccup — try again).
 */

type Billing = { billingUrl: string; limit: string };

type Probe =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "works"; message: string; models: string[]; suggested: string | null }
  /** The vendor knows the key but cannot bill it yet — saved, with the way forward. */
  | { state: "unfunded"; message: string; billing: Billing }
  | { state: "refused"; message: string };

type ProbeResponse = {
  works: boolean;
  state: "works" | "unfunded" | "refused" | "unreachable";
  message: string;
  models: string[];
  suggested: string | null;
  billing: Billing;
};

export function OwnModelForm({
  existing,
  changeOnly,
  onSaved,
  onCancel,
}: {
  /** What is already connected — a vendor here is replaced, not duplicated. */
  existing: OwnModelRow[];
  /** Set = change this vendor's model with the stored key; no paste. */
  changeOnly: OwnModelRow | null;
  /** `note` is set when the key was saved but needs a follow-up (unfunded). */
  onSaved: (models: OwnModelRow[], note: string | null) => void;
  onCancel: (() => void) | null;
}) {
  const [vendor, setVendor] = useState<ByokVendorId>(changeOnly?.vendor ?? BYOK_VENDORS[0]!.id);
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const probeSeq = useRef(0);

  /** Check a key (or, with none, the stored one) and load what it can use. */
  const runProbe = useCallback(async (forVendor: ByokVendorId, key: string | null) => {
    const seq = ++probeSeq.current;
    setProbe({ state: "checking" });
    setError(null);
    try {
      const data = await ownModelRequest<ProbeResponse>("/api/settings/model/probe", "POST", {
        vendor: forVendor,
        ...(key ? { apiKey: key } : {}),
      });
      if (seq !== probeSeq.current) return; // a newer paste has taken over
      if (data.works) {
        setProbe({
          state: "works",
          message: data.message,
          models: data.models,
          suggested: data.suggested,
        });
        setModel(data.suggested ?? "");
      } else if (data.state === "unfunded") {
        setProbe({ state: "unfunded", message: data.message, billing: data.billing });
        setModel("");
      } else {
        setProbe({ state: "refused", message: data.message });
      }
    } catch (e) {
      if (seq === probeSeq.current) {
        setProbe({
          state: "refused",
          message: e instanceof Error ? e.message : "Couldn't check the key.",
        });
      }
    }
  }, []);

  // Changing the model only: list what the stored key can use, no paste.
  useEffect(() => {
    if (!changeOnly) return;
    const timer = setTimeout(() => void runProbe(changeOnly.vendor, null), 0);
    return () => clearTimeout(timer);
  }, [changeOnly, runProbe]);

  // Check a pasted key as soon as the reader stops typing — no "Check" button
  // to find. Short keys are not sent: nothing a vendor issues is that short.
  useEffect(() => {
    const key = apiKey.trim();
    if (key.length < 8) return;
    const timer = setTimeout(() => void runProbe(vendor, key), 600);
    return () => clearTimeout(timer);
  }, [apiKey, vendor, runProbe]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await ownModelRequest<{
        models: OwnModelRow[];
        unfunded?: { message: string; billing: Billing };
      }>("/api/settings/model", "PUT", {
        vendor,
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      onSaved(
        data.models,
        data.unfunded
          ? `${info.label} key saved. It answers once the account has credits — see the billing link on its row.`
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const info = byokVendor(vendor)!;
  const replaces = !changeOnly && existing.find((m) => m.vendor === vendor);
  const canSave =
    !saving &&
    (probe.state === "works" || probe.state === "unfunded") &&
    model.trim().length > 0 &&
    (apiKey.trim().length > 0 || changeOnly !== null);

  return (
    <div className="space-y-4">
      {!changeOnly && (
        <div>
          <p className="ui-micro-label mb-2">1 · Your provider</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Provider">
            {BYOK_VENDORS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={vendor === v.id}
                className={`ui-chip-toggle ${vendor === v.id ? "ui-chip-toggle-active" : ""}`}
                onClick={() => {
                  setVendor(v.id);
                  setProbe({ state: "idle" });
                  setModel("");
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          {vendor === "openrouter" && (
            <p className="mt-2 text-xs text-text-muted">
              One OpenRouter key reaches models from every major lab — the easiest way to use the
              strongest ones.
            </p>
          )}
          {replaces && (
            <p className="mt-2 text-xs text-text-muted">
              You already have a {info.label} key ({replaces.keyHint}). Pasting a new one replaces
              it.
            </p>
          )}
        </div>
      )}

      {!changeOnly && (
        <div>
          <p className="ui-micro-label mb-2">2 · Your key</p>
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 inline-flex items-center gap-1 text-sm text-accent-text underline-offset-2 hover:underline"
          >
            Get a key from {info.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <input
            type="password"
            className="ui-input w-full font-mono"
            placeholder={`Paste your ${info.label} key${info.keyHint ? ` (${info.keyHint})` : ""}`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${info.label} API key`}
          />
        </div>
      )}

      <div className="min-h-5 text-sm" aria-live="polite">
        {probe.state === "checking" && (
          <span className="inline-flex items-center gap-2 text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking with{" "}
            {info.label}…
          </span>
        )}
        {probe.state === "works" && (
          <span className="inline-flex items-center gap-2 text-status-positive">
            <Check className="h-4 w-4" aria-hidden="true" /> {probe.message}
          </span>
        )}
        {probe.state === "refused" && (
          <span className="inline-flex items-start gap-2 text-status-negative">
            <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {probe.message}
          </span>
        )}
      </div>

      {/* Not a wall. The key is right; the account behind it is empty, and the
          page that fixes that is one tap away. Saved now, used the moment the
          vendor's meter allows. */}
      {probe.state === "unfunded" && (
        <div className="ui-callout-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium text-text-primary">
              {info.label} knows this key but can&apos;t bill it yet.
            </p>
            <p className="text-xs text-text-secondary">{probe.message}</p>
            <p className="text-xs text-text-secondary">
              Add credits or raise {probe.billing.limit} at{" "}
              <a
                href={probe.billing.billingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-text underline-offset-2 hover:underline"
              >
                {info.label}&apos;s billing page{" "}
                <ExternalLink className="inline h-3 w-3" aria-hidden="true" />
              </a>
              . You can save the key now — Loki uses it the moment {info.label} does. A few francs
              with a spending limit is enough to see how a model thinks.
            </p>
          </div>
        </div>
      )}

      {(probe.state === "works" || probe.state === "unfunded") && (
        <div>
          <p className="ui-micro-label mb-2">{changeOnly ? "Model" : "3 · Your model"}</p>
          {probe.state === "works" && probe.models.length > 0 ? (
            <select
              className="ui-input w-full"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model"
            >
              {probe.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === probe.suggested ? " — strongest available" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="ui-input w-full font-mono"
              placeholder={info.modelExample}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model id"
            />
          )}
          {probe.state === "unfunded" && (
            <p className="mt-1 text-xs text-text-muted">
              {info.label} would not list models for an unfunded key, so type the one you want — for
              example <span className="font-mono">{info.modelExample}</span>.
            </p>
          )}
          {probe.state === "works" && probe.suggested && model === probe.suggested && (
            <p className="mt-1 text-xs text-text-muted">
              Chosen for you: the newest model in the strongest tier your key can use. Pick another
              any time.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ui-btn-primary"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {changeOnly
            ? "Use this model"
            : probe.state === "unfunded"
              ? "Save the key anyway"
              : "Add this model"}
        </button>
        {onCancel && (
          <button type="button" className="ui-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {!changeOnly && (
        <p className="text-xs text-text-muted">
          Your key is encrypted before it&apos;s stored and is only used for your own Loki chats. It
          is never shown again — only its last four characters. Remove it here any time.
        </p>
      )}

      {error && <p className="ui-error text-sm">{error}</p>}
    </div>
  );
}
