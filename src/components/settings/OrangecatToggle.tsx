"use client";

/**
 * "Also for your OrangeCat bots", under a key in Settings → Your model.
 *
 * On: the person's bots on OrangeCat answer on this key. Loki makes each
 * model call for them, as the linked account (lib/orangecat-model.ts); the
 * key itself stays in Loki, so removing it here, or switching this off, ends
 * it there too. The same switch can be set from OrangeCat, by the same person
 * signed in there. Off by default.
 */
export function OrangecatToggle({
  on,
  busy,
  onChange,
}: {
  on: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="ui-switch-row mt-2">
      <div className="min-w-0">
        <p className="text-sm text-text-primary">Also for your OrangeCat bots</p>
        <p className="text-xs text-text-secondary">
          {on
            ? "Your bots on OrangeCat answer on this key, through Loki. The key stays here; your vendor bills their messages."
            : "Lets your bots on OrangeCat answer on this key, through Loki. The key stays here."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Also for your OrangeCat bots"
        className={on ? "ui-switch ui-switch-on" : "ui-switch"}
        disabled={busy}
        onClick={() => onChange(!on)}
      >
        <span className="ui-switch-knob" />
      </button>
    </div>
  );
}
