"use client";

import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";

/**
 * The opt-out, where the thing it opts out of lives.
 *
 * Deliberately on /approvals rather than in a settings page: this control only
 * makes sense next to the queue it shortens, and someone annoyed by the queue
 * is looking at the queue, not hunting through settings for the word "standing".
 *
 * The eligible list is supplied by the server from the hard-coded set in
 * lib/actions/standing-approval.ts — it is never assembled here. A client that
 * could name its own types would be a client that decides what may run without
 * asking, which is exactly the authority this component must not have.
 */
export type StandingOption = {
  type: string;
  label: string;
  detail: string;
};

export function StandingApprovals({
  options,
  initial,
}: {
  options: StandingOption[];
  initial: string[];
}) {
  const [enabled, setEnabled] = useState<string[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(type: string) {
    const next = enabled.includes(type) ? enabled.filter((t) => t !== type) : [...enabled, type];
    // Optimistic, then reverted on failure. A switch that does not move until
    // the network answers reads as broken on a slow connection — but a switch
    // that STAYS moved after a failed save is worse than either, because it
    // claims an authorisation the server never recorded.
    const previous = enabled;
    setEnabled(next);
    setSaving(type);
    setError(null);
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ standingApprovals: next }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setEnabled(previous);
      setError("Could not save that — nothing changed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="ui-card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Standing approvals</h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            Decide once instead of every time. Loki carries these out as you ask for them and tells
            you what it did. Everything that reaches other people always waits for your yes.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {options.map((option) => {
          const on = enabled.includes(option.type);
          return (
            <li key={option.type}>
              <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-surface-raised">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={saving !== null}
                  onChange={() => toggle(option.type)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm">
                    {option.label}
                    {saving === option.type && (
                      <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-secondary">{option.detail}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p className="ui-error text-xs">{error}</p>}
    </div>
  );
}
