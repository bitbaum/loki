"use client";

import { useState } from "react";
import { Section } from "@/components/ui/section-heading";
import { OptionRow } from "@/components/terminal/sheet-rows";

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

  // Rows you switch, under a plain heading — no card, no paragraph over them
  // (design reset rules 2 and 3). Each row's own line says what it allows.
  return (
    <Section title="Standing approvals" className="ui-approvals-standing">
      <div className="flex flex-col">
        {options.map((option) => (
          <OptionRow
            key={option.type}
            toggle
            title={option.label}
            detail={option.detail}
            active={enabled.includes(option.type)}
            busy={saving === option.type}
            disabled={saving !== null}
            onSelect={() => void toggle(option.type)}
          />
        ))}
      </div>
      {error && (
        <p className="ui-error mt-2 text-sm" role="status">
          {error}
        </p>
      )}
    </Section>
  );
}
