"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Loader2, Sparkles } from "lucide-react";
import { CUSTOM_VENDOR_ID, vendorById } from "@/config/model-vendors";
import { STANCES, TIERS, type Stance } from "@/lib/models/auto-picks";
import type { ModelTier } from "@/lib/models/store-catalog";
import type { RoutingView } from "@/lib/models/routing";
import { ownModelRequest } from "@/lib/own-model-client";
import { indexLabel, money } from "./format";

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
export function AutoRouting({
  compact = false,
  heading = true,
}: {
  compact?: boolean;
  /** False when the card around it already carries the title and the line. */
  heading?: boolean;
}) {
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

  const picks = (
    <dl className="ui-auto-picks">
      {TIERS.map((tier) => {
        const pick = view.picks.find((p) => p.tier === tier.id);
        const selected = pick
          ? view.candidates.find((c) => c.vendor === pick.vendor && c.model === pick.model)
          : null;
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
                      <option key={`${c.vendor}/${c.model}`} value={`${c.vendor}\u0000${c.model}`}>
                        {c.name} · {keyName(c.vendor)}
                      </option>
                    ))}
                  </select>
                  {selected && (selected.outPerM !== null || selected.index !== null) && (
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                      {selected.outPerM !== null &&
                        `Output: $${money(selected.outPerM)} USD per 1M tokens`}
                      {selected.outPerM !== null && selected.index !== null && " · "}
                      {selected.index !== null &&
                        `Intelligence index: ${indexLabel(selected.index)}/100`}
                    </p>
                  )}
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
  );

  return (
    <section
      aria-labelledby={heading ? "auto-title" : undefined}
      className={compact ? "ui-auto-strip" : "space-y-4"}
    >
      <div className="flex flex-col gap-3">
        {heading && (
          <div>
            <h3 id="auto-title" className="flex items-center gap-2 font-medium text-text-primary">
              <Sparkles className="h-4 w-4 text-accent-text" aria-hidden="true" /> What Auto picks
              for you
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              Auto chooses a model for each request. Small requests use economical models; your
              preference sets how much to spend on harder work.
            </p>
          </div>
        )}
        <Segmented
          label="Stance"
          options={STANCES.map((s) => ({ id: s.id, label: s.label, means: s.line }))}
          value={view.stance}
          onChange={(id) => {
            if (busy === null) void put({ stance: id as Stance }, "stance");
          }}
        />
      </div>
      {compact ? (
        <details>
          <summary className="ui-tap cursor-pointer text-sm text-text-secondary">
            Review model choices
          </summary>
          {picks}
        </details>
      ) : (
        picks
      )}
      {error && <p className="ui-error text-sm">{error}</p>}
      {/* Where the numbers come from, and how old they are. A price and an
          index with no source read as typed by hand — and typed numbers rot
          the week a lab moves its prices. These are read, and say when. */}
      <p className="text-xs text-text-muted">
        Prices are OpenRouter&apos;s quoted USD rates and the intelligence index is Artificial
        Analysis&apos; as OpenRouter relays it, read from its public catalogue
        {view.catalogReadAt === null
          ? " — not read yet"
          : ` at ${new Date(view.catalogReadAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
        . Your provider&apos;s own page has the price you are billed.
      </p>
    </section>
  );
}

function tierRank(t: ModelTier): number {
  return t === "economy" ? 0 : t === "standard" ? 1 : 2;
}
