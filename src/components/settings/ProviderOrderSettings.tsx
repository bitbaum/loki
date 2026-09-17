"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Loader2 } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import { TOAST_SHORT_MS } from "@/lib/constants/timings";
import { providerLabel } from "@/config/quota-alternatives";
import { parseProviderOrder, preferredProviderOrder } from "@/lib/provider-switch";
import type { UserPreferencesData } from "@/db/queries/user-preferences";

/**
 * The order the fleet reaches for a new provider in when one runs out.
 *
 * This is the half of "one-tap provider switch" that makes the tap predictable.
 * Without it the chooser had to pick from a hardcoded fleet default, so the
 * button said "Try Cursor" to an operator whose Cursor subscription lapsed
 * months ago — and the only way to change it was to set a per-project agent
 * preference, project by project, after the fact.
 *
 * Deliberately a list and not a per-agent toggle: an agent the operator does
 * not want is simply ranked last, and nothing is ever hidden from the chooser.
 * A provider that is genuinely unusable is already excluded by evidence (not
 * installed, or observed out of quota) — hiding it here as well would give two
 * different mechanisms the same job and no way to tell which one applied.
 */
export function ProviderOrderSettings({ initialPrefs }: { initialPrefs: UserPreferencesData }) {
  const [order, setOrder] = useState(() =>
    preferredProviderOrder(parseProviderOrder(initialPrefs.agentOrder)),
  );
  const [savedOrder, setSavedOrder] = useState(order);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const dirty = order.join(",") !== savedOrder.join(",");

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setOrder(next);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await patchJson("/api/me/preferences", { agentOrder: order });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to save");
        return;
      }
      setSavedOrder(order);
      setSaved(true);
      setTimeout(() => setSaved(false), TOAST_SHORT_MS);
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-settings-section">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-text-primary">Provider order</h2>
        <p className="text-xs text-text-secondary">
          When the agent building a project hits a rate limit, “Try next provider” walks this list
          from the top and offers the first one that can actually answer — installed on your
          builder, and not itself out of quota.
        </p>
      </div>

      <ol className="space-y-2">
        {order.map((id, i) => (
          <li key={id} className="ui-list-item">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-micro text-text-muted">{i + 1}</span>
              <span className="truncate text-sm text-text-primary">{providerLabel(id)}</span>
              {i === 0 && <span className="ui-badge shrink-0">first choice</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="ui-btn-icon"
                title={`Move ${providerLabel(id)} up`}
                aria-label={`Move ${providerLabel(id)} up`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                className="ui-btn-icon"
                title={`Move ${providerLabel(id)} down`}
                aria-label={`Move ${providerLabel(id)} down`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ol>

      {error && <p className="ui-error">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || saving} className="ui-btn-save">
          {saving ? <Loader2 className="ui-spinner-xs" /> : null}
          Save order
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-status-positive">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>
    </section>
  );
}
