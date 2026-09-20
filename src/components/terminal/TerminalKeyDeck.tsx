"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  KEY_HAPTIC_MS,
  KEY_REPEAT_DELAY_MS,
  KEY_REPEAT_INTERVAL_MS,
  TERMINAL_ARROW_KEYS,
  TERMINAL_KEYS,
  TERMINAL_PRIMARY_KEYS,
  TERMINAL_SECONDARY_GROUPS,
  type TerminalKey,
  type TerminalKeyId,
} from "@/config/terminal-keys";

/** Short, quiet confirmation that a keycap took. A terminal answers in its own
 *  time — a byte sent to a busy agent can take a second to redraw — so without
 *  this the operator taps ▼ again, and again, and lands three rows down. */
function tick() {
  try {
    navigator.vibrate?.(KEY_HAPTIC_MS);
  } catch {
    /* unsupported or blocked */
  }
}

/**
 * One keycap. Fires on pointerdown, not click, for two reasons that both
 * matter here: a key you are *holding* has to repeat from the moment it goes
 * down, and pointerdown is the event that can be prevented before the browser
 * moves focus — which is what stops every tap from dismissing the soft keyboard
 * and leaving the composer.
 */
function KeyCap({
  keyDef,
  onKey,
  className,
}: {
  keyDef: TerminalKey;
  onKey: (bytes: string) => void;
  className?: string;
}) {
  const timers = useRef<{ delay: number; interval: number }>({ delay: 0, interval: 0 });
  const [held, setHeld] = useState(false);

  const stop = useCallback(() => {
    if (timers.current.delay) window.clearTimeout(timers.current.delay);
    if (timers.current.interval) window.clearInterval(timers.current.interval);
    timers.current = { delay: 0, interval: 0 };
    setHeld(false);
  }, []);

  // A pointer that leaves the page (drag off-screen, a call arriving) never
  // delivers pointerup to the button, and an arrow key repeating forever is a
  // ruined session. Clean up on unmount and on window-level release too.
  useEffect(() => {
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stop();
    };
  }, [stop]);

  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Keep focus (and therefore the keyboard) exactly where it is.
    e.preventDefault();
    setHeld(true);
    tick();
    onKey(keyDef.bytes);
    if (!keyDef.repeatable) return;
    timers.current.delay = window.setTimeout(() => {
      timers.current.interval = window.setInterval(
        () => onKey(keyDef.bytes),
        KEY_REPEAT_INTERVAL_MS,
      );
    }, KEY_REPEAT_DELAY_MS);
  };

  return (
    <button
      type="button"
      className={cn(className, held && "ui-term-key-held")}
      onPointerDown={press}
      onPointerUp={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
      // Physical-keyboard parity: a focused keycap still activates on
      // Enter/Space without going through pointer events at all.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onKey(keyDef.bytes);
      }}
      aria-label={keyDef.aria}
      title={keyDef.aria}
    >
      {keyDef.label}
    </button>
  );
}

/**
 * The key deck — the keys a phone does not have, as buttons.
 *
 * This is the whole reason the terminal is usable on a phone. An agent asking
 * "Also scan shell history [✔] — ◄ Mixed ► — Continue" wants ▲▼ to move, ◄►
 * to change, Space to tick and Enter to commit; a soft keyboard offers none of
 * them, so before this deck the only honest description of /terminal on a phone
 * was read-only. Bytes come from config/terminal-keys.ts; this file is layout,
 * repeat-on-hold, and haptics.
 *
 * Shape is deliberate: the four arrows are one *joined* control, because they
 * are one control in the operator's head and four separate pills read as four
 * unrelated choices. Enter is the only accented key on the row — it is the one
 * that commits, and it should be the one the thumb finds without looking.
 *
 * Both rows are always present. A "⋯ more keys" toggle was built first and then
 * removed for two reasons that turned out to be the same reason: at 320px it
 * cost the deck row 50 pixels it did not have (measured: 328px of keys in a
 * 288px row), and the lane it hid contains Space — the key that ticks the
 * checkbox in the very prompt this deck exists to answer. A control that hides
 * the answer behind a glyph nobody presses is not a saving.
 */
export function TerminalKeyDeck({ onKey }: { onKey: (bytes: string) => void }) {
  const cap = (id: TerminalKeyId, className: string) => (
    <KeyCap key={id} keyDef={TERMINAL_KEYS[id]} onKey={onKey} className={className} />
  );

  return (
    <div className="ui-term-deck">
      <div className="ui-term-key-lane ui-scroll-fade-right" role="group" aria-label="More keys">
        {TERMINAL_SECONDARY_GROUPS.map((group) => (
          <div key={group.label} className="ui-term-key-group">
            <span className="ui-term-key-group-label">{group.label}</span>
            {group.keys.map((id) =>
              cap(id, id === "ctrl-c" ? "ui-term-key ui-term-key-danger" : "ui-term-key"),
            )}
          </div>
        ))}
      </div>

      <div className="ui-term-deck-row" role="group" aria-label="Terminal keys">
        {TERMINAL_PRIMARY_KEYS.map((id) => cap(id, "ui-term-key"))}

        <div className="ui-term-key-cluster">
          {TERMINAL_ARROW_KEYS.map((id) => cap(id, "ui-term-key-arrow"))}
        </div>

        {cap("enter", "ui-term-key ui-term-key-accent")}
      </div>
    </div>
  );
}
