"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { CUSTOM_VENDOR_ID, vendorById } from "@/config/model-vendors";
import { STANCES, TIERS, type Stance } from "@/lib/models/auto-picks";
import type { ModelTier } from "@/lib/models/store-catalog";
import type { RoutingView } from "@/lib/models/routing";
import { ownModelRequest } from "@/lib/own-model-client";
import { money } from "./format";

/**
 * "What answers what": the stance, and the three picks with a way to change
 * each. One component for the store (above the table, when keys are held)
 * and for Settings → AI (under the keys), so the two never disagree about
 * what Auto will do.
 *
 * Every line names the consequence: a stance says what it spends, a pick
 * says why it was chosen, a changed pick says "your choice". Nothing here is
 * a wall — "Loki decides" puts a tier back on the computed pick.
 */
export function AutoRouting({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<RoutingView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ownModelRequest<RoutingView>("/api/settings/model/routing", "GET")
      .then((v) => {
        if (alive) setView(v);
      })
      .catch(() => {
        if (alive) setError("Couldn't read how Auto is set up.");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function put(body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      setView(await ownModelRequest<RoutingView>("/api/settings/model/routing", "PUT", body));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !view) return <p className="ui-error text-sm">{error}</p>;
  if (!view) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading how Auto is set up
      </p>
    );
  }
  if (view.keys.length === 0) return null;

  const name = (vendor: string, model: string) =>
    view.candidates.find((c) => c.vendor === vendor && c.model === model)?.name ?? model;
  const keyName = (vendor: string) =>
    vendor === CUSTOM_VENDOR_ID
      ? (view.keys.find((k) => k.vendor === vendor)?.label ?? "your endpoint")
      : (vendorById(vendor)?.label ?? vendor);

  return (
    <section aria-labelledby="auto-title" className={compact ? "ui-auto-strip" : "space-y-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="auto-title" className="flex items-center gap-2 font-medium text-text-primary">
            <Sparkles className="h-4 w-4 text-accent-text" aria-hidden="true" /> What Auto picks for
            you
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Each turn is judged light, standard or heavy before a model is chosen, so a greeting
            never spends a frontier model. Your stance says how far up to reach.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Stance">
          {STANCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={view.stance === s.id}
              title={s.line}
              className={view.stance === s.id ? "ui-chip-toggle-active" : "ui-chip-toggle"}
              disabled={busy !== null}
              onClick={() => void put({ stance: s.id satisfies Stance }, "stance")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-muted">{STANCES.find((s) => s.id === view.stance)?.line}</p>
      <dl className="ui-auto-picks">
        {TIERS.map((tier) => {
          const pick = view.picks.find((p) => p.tier === tier.id);
          const options = view.candidates.filter((c) => tierRank(c.tier) <= tierRank(tier.id) + 1);
          return (
            <div key={tier.id} className="ui-auto-pick">
              <dt>
                <span className="font-medium text-text-primary">{tier.label}</span>
                <span className="block text-xs text-text-muted">{tier.forTurns}</span>
              </dt>
              <dd>
                {pick ? (
                  <>
                    <select
                      className="ui-input ui-input-compact w-full"
                      value={`${pick.vendor}\u0000${pick.model}`}
                      disabled={busy !== null}
                      aria-label={`${tier.label}: model`}
                      onChange={(e) => {
                        const [vendor, model] = e.target.value.split("\u0000");
                        void put({ tier: tier.id, vendor, model }, tier.id);
                      }}
                    >
                      {!options.some((c) => c.vendor === pick.vendor && c.model === pick.model) && (
                        <option value={`${pick.vendor}\u0000${pick.model}`}>
                          {name(pick.vendor, pick.model)} · {keyName(pick.vendor)}
                        </option>
                      )}
                      {options.map((c) => (
                        <option
                          key={`${c.vendor}/${c.model}`}
                          value={`${c.vendor}\u0000${c.model}`}
                        >
                          {c.name} · {keyName(c.vendor)}
                          {c.index !== null ? ` · ${Math.round(c.index)}` : ""}
                          {c.outPerM !== null ? ` · $${money(c.outPerM)} out` : ""}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      {busy === tier.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : null}
                      {pick.chosenBy === "user" ? "Your choice" : pick.reason} · on{" "}
                      {keyName(pick.vendor)}
                      {pick.chosenBy === "user" && (
                        <button
                          type="button"
                          className="text-accent-text underline-offset-2 hover:underline"
                          disabled={busy !== null}
                          onClick={() => void put({ tier: tier.id, reset: true }, tier.id)}
                        >
                          Loki decides
                        </button>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-text-muted">
                    Nothing your keys reach fits here yet.
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {error && <p className="ui-error text-sm">{error}</p>}
    </section>
  );
}

function tierRank(t: ModelTier): number {
  return t === "economy" ? 0 : t === "standard" ? 1 : 2;
}
