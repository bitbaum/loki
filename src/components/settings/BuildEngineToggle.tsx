"use client";

/**
 * "Also for building": one key, one switch, as a row. On, the key reaches the
 * person's private builder on Loki's cloud as the agent CLI's own variable
 * and their builds run on it; off, it powers Loki's chat only. The line under
 * the label says which CLI and whose meter it runs on, so nobody marks a key
 * for building without knowing who pays.
 *
 * It was a chip with its explanation squeezed into the column beside it,
 * wrapping four words to a line on a phone (2026-10-21). An on/off setting is
 * a row: the words on the left, the switch on the right, like every other.
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
    <div className="ui-switch-row mt-2">
      <div className="min-w-0">
        <p className="text-sm text-text-primary">Also for building</p>
        <p className="text-xs text-text-secondary">
          {on
            ? `${agent} in your cloud runner runs on this key — your vendor bills every build. Reaches the runner within a minute.`
            : `Lets ${agent} in your cloud runner run on this key instead of a sign-in. Your vendor bills the builds.`}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Also for building with ${agent}`}
        className={on ? "ui-switch ui-switch-on" : "ui-switch"}
        disabled={busy}
        onClick={() => onChange(!on)}
      >
        <span className="ui-switch-knob" />
      </button>
    </div>
  );
}
