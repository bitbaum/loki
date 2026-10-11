"use client";

import { BYOK_VENDORS, type ByokVendorId } from "@bitbaum/ai-kit/byok";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { button, buttonQuiet, card, errorText, input, label, link, notice } from "@/components/ui";

type Saved = { vendor: string; model: string; hint: string } | null;
type Probe = {
  ok: boolean;
  status: number | null;
  message: string;
  models: string[];
  suggested: string | null;
};

/**
 * Your own model (fleet SHARED.md, "Your own model"): pick a provider, get a
 * key, paste it — it is checked on its own a moment after typing stops, the
 * models that key can use are listed with the strongest preselected, one
 * button saves. The key is sealed on the server and never shown again; an
 * empty field never wipes a saved key — removing is its own button.
 */
export function OwnModelSettings() {
  const t = useTranslations("OwnModel");
  const [saved, setSaved] = useState<Saved>(null);
  const [canSave, setCanSave] = useState(true);
  const [vendor, setVendor] = useState<ByokVendorId>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [model, setModel] = useState("");
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void fetch("/api/settings/model")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { saved: Saved; canSave: boolean } | null) => {
        if (!body) return;
        setSaved(body.saved);
        setCanSave(body.canSave);
      });
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (apiKey.trim().length < 8) return;
    timer.current = setTimeout(async () => {
      setChecking(true);
      const response = await fetch("/api/settings/model/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendor, apiKey: apiKey.trim() }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as Probe | null;
      setChecking(false);
      if (!result) {
        setProbe({
          ok: false,
          status: null,
          message: t("couldNotCheck"),
          models: [],
          suggested: null,
        });
        return;
      }
      setProbe(result);
      setModel(result.suggested ?? result.models[0] ?? "");
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [apiKey, vendor, t]);

  async function save() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/settings/model", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendor, apiKey: apiKey.trim(), model }),
    });
    const body = (await response.json().catch(() => ({}))) as { saved?: Saved; error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(t(`errors.${body.error === "model_not_available" ? "model" : "save"}`));
      return;
    }
    setSaved(body.saved ?? null);
    setApiKey("");
    setProbe(null);
  }

  async function remove() {
    setBusy(true);
    await fetch("/api/settings/model", { method: "DELETE" });
    setSaved(null);
    setBusy(false);
  }

  const chosen = BYOK_VENDORS.find((v) => v.id === vendor);

  return (
    <section className={card} aria-labelledby="own-model">
      <h2 id="own-model" className="mb-2 text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mb-4 text-sm text-fg-secondary">{t("lede")}</p>

      {saved && (
        <div className={`${notice} mb-4 flex flex-wrap items-center justify-between gap-3`}>
          <span>{t("savedAs", { model: saved.model, hint: saved.hint })}</span>
          <button type="button" className={buttonQuiet} onClick={remove} disabled={busy}>
            {t("remove")}
          </button>
        </div>
      )}

      {!canSave ? (
        <p className={notice}>{t("unavailable")}</p>
      ) : (
        <div className="grid gap-4">
          <fieldset>
            <legend className={label}>{t("provider")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BYOK_VENDORS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={v.id === vendor}
                  onClick={() => {
                    setVendor(v.id);
                    setProbe(null);
                  }}
                  className={`${buttonQuiet} aria-pressed:border-accent aria-pressed:font-semibold`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </fieldset>
          {chosen && (
            <a href={chosen.keyUrl} className={link} rel="noreferrer" target="_blank">
              {t("getKey", { provider: chosen.label })}
            </a>
          )}
          <div className="grid gap-1.5">
            <label htmlFor="model-key" className={label}>
              {t("key")}
            </label>
            <input
              id="model-key"
              type="password"
              className={input}
              autoComplete="off"
              spellCheck={false}
              placeholder={chosen?.keyHint}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setProbe(null);
              }}
            />
          </div>
          {checking && <p role="status">{t("checking")}</p>}
          {probe && !probe.ok && (
            <p role="alert" className={errorText}>
              {probe.status === null ? t("couldNotCheck") : probe.message}
            </p>
          )}
          {probe?.ok && (
            <div className="grid gap-1.5">
              <label htmlFor="model" className={label}>
                {t("model")}
              </label>
              {probe.models.length > 0 ? (
                <select
                  id="model"
                  className={input}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {probe.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="model"
                  className={input}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
            </div>
          )}
          {error && (
            <p role="alert" className={errorText}>
              {error}
            </p>
          )}
          <button
            type="button"
            className={button}
            onClick={save}
            disabled={busy || !probe?.ok || !model}
          >
            {t("save")}
          </button>
        </div>
      )}
    </section>
  );
}
