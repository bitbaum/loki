"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, KeyRound, Loader2, X } from "lucide-react";
import { BYOK_VENDORS, byokVendor, type ByokVendorId } from "@bitbaum/ai-kit/byok";

/**
 * "Power Loki with your own model" — the whole flow in one place.
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

type Current = { vendor: ByokVendorId; model: string; keyHint: string; verifiedAt: string } | null;

type Probe =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "works"; message: string; models: string[]; suggested: string | null }
  | { state: "refused"; message: string };

async function post<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function OwnModelSettings() {
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [current, setCurrent] = useState<Current>(null);
  const [editing, setEditing] = useState(false);

  const [vendor, setVendor] = useState<ByokVendorId>(BYOK_VENDORS[0]!.id);
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const probeSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await post<{ available: boolean; current: Current }>(
          "/api/settings/model",
          "GET",
        );
        if (!alive) return;
        setAvailable(data.available);
        setCurrent(data.current);
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

  /** Check a key (or, with none, the stored one) and load what it can use. */
  const runProbe = useCallback(async (forVendor: ByokVendorId, key: string | null) => {
    const seq = ++probeSeq.current;
    setProbe({ state: "checking" });
    setError(null);
    try {
      const data = await post<{
        works: boolean;
        message: string;
        models: string[];
        suggested: string | null;
      }>("/api/settings/model/probe", "POST", { vendor: forVendor, ...(key ? { apiKey: key } : {}) });
      if (seq !== probeSeq.current) return; // a newer paste has taken over
      if (data.works) {
        setProbe({ state: "works", message: data.message, models: data.models, suggested: data.suggested });
        setModel(data.suggested ?? "");
      } else {
        setProbe({ state: "refused", message: data.message });
      }
    } catch (e) {
      if (seq === probeSeq.current) {
        setProbe({ state: "refused", message: e instanceof Error ? e.message : "Couldn't check the key." });
      }
    }
  }, []);

  // Check a pasted key as soon as the reader stops typing — no "Check" button
  // to find. Short keys are not sent: nothing a vendor issues is that short.
  useEffect(() => {
    const key = apiKey.trim();
    if (key.length < 8) return;
    const timer = setTimeout(() => void runProbe(vendor, key), 600);
    return () => clearTimeout(timer);
  }, [apiKey, vendor, runProbe]);

  function startConnect(replaceKey: boolean) {
    setEditing(true);
    setError(null);
    setApiKey("");
    setModel("");
    setProbe({ state: "idle" });
    if (current && !replaceKey) {
      // Change model only: list what the stored key can use, no paste needed.
      setVendor(current.vendor);
      void runProbe(current.vendor, null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await post<{ current: Current }>("/api/settings/model", "PUT", {
        vendor,
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setCurrent(data.current);
      setEditing(false);
      setApiKey("");
      setProbe({ state: "idle" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setError(null);
    try {
      await post("/api/settings/model", "DELETE");
      setCurrent(null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disconnect.");
    } finally {
      setSaving(false);
    }
  }

  const info = byokVendor(vendor)!;
  const changingModelOnly = editing && current !== null && current.vendor === vendor && !apiKey.trim();
  const canSave =
    !saving && probe.state === "works" && model.trim().length > 0 && (apiKey.trim().length > 0 || changingModelOnly);

  return (
    <section className="ui-settings-section">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-text-primary">
          <KeyRound className="h-4 w-4 text-accent-text" aria-hidden="true" />
          Power Loki with your own model
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Loki runs on free, shared models with a daily limit. Connect a key from any provider below
          and Loki thinks with the best model your account can use — no daily limit, billed to you by
          your provider.
        </p>
      </div>

      {!loaded && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading your settings
        </p>
      )}

      {loaded && !available && (
        <p className="ui-callout-warning">
          Connecting your own model isn&apos;t switched on for this server yet — Loki keeps using its
          free models.
        </p>
      )}

      {loaded && available && current && !editing && (
        <div className="ui-callout-positive flex-wrap">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text-primary">
              Loki is thinking with {byokVendor(current.vendor)?.label ?? current.vendor} ·{" "}
              <span className="break-all">{current.model}</span>
            </p>
            <p className="text-xs text-text-secondary">
              Your key {current.keyHint} · checked {new Date(current.verifiedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn-secondary text-xs" onClick={() => startConnect(false)}>
              Change model
            </button>
            <button type="button" className="ui-btn-ghost text-xs" onClick={() => startConnect(true)}>
              Replace key
            </button>
            <button type="button" className="ui-btn-ghost text-xs" onClick={() => void disconnect()} disabled={saving}>
              Disconnect
            </button>
          </div>
        </div>
      )}

      {loaded && available && (!current || editing) && (
        <div className="space-y-4">
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
          </div>

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
              placeholder={
                changingModelOnly ? `Using your saved key ${current?.keyHint}` : `Paste your ${info.label} key${info.keyHint ? ` (${info.keyHint})` : ""}`
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={`${info.label} API key`}
            />
            <div className="mt-2 min-h-5 text-sm" aria-live="polite">
              {probe.state === "checking" && (
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking with {info.label}…
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
          </div>

          {probe.state === "works" && (
            <div>
              <p className="ui-micro-label mb-2">3 · Your model</p>
              {probe.models.length > 0 ? (
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
              {probe.suggested && model === probe.suggested && (
                <p className="mt-1 text-xs text-text-muted">
                  Chosen for you: the newest model in the strongest tier your key can use. Pick
                  another any time.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn-primary" disabled={!canSave} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Use this model
            </button>
            {editing && (
              <button type="button" className="ui-btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>

          <p className="text-xs text-text-muted">
            Your key is encrypted before it&apos;s stored and is only used for your own Loki chats. It
            is never shown again — only its last four characters. Remove it here any time.
          </p>
        </div>
      )}

      {error && <p className="ui-error text-sm">{error}</p>}
    </section>
  );
}
