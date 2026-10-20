"use client";

import { Hammer } from "lucide-react";

/**
 * "Also for building": one key, one switch. On, the key reaches the person's
 * private builder on Loki's cloud as the agent CLI's own variable and their
 * builds run on it; off, it powers Loki's chat only. The sentence under it
 * says which CLI and what it costs them, so nobody marks a key for building
 * without knowing whose meter it runs on.
 */
export function BuildEngineToggle({
  agent,
  on,
  busy,
  onChange,
}: {
  agent: string;
  on: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-2 flex items-start gap-3 text-xs">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={on ? "ui-chip-toggle ui-chip-toggle-active shrink-0" : "ui-chip-toggle shrink-0"}
        disabled={busy}
        onClick={() => onChange(!on)}
      >
        <Hammer className="h-3.5 w-3.5" aria-hidden="true" />
        {on ? `Builds with ${agent}` : `Also for building`}
      </button>
      <span className="min-w-0 flex-1 text-text-secondary">
        {on
          ? `${agent} in your cloud builder runs on this key — your vendor bills every build. Reaches the builder within a minute.`
          : `Lets ${agent} in your cloud builder run on this key instead of a sign-in. Your vendor bills the builds.`}
      </span>
    </div>
  );
}
