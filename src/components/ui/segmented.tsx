"use client";

import { cn } from "@/lib/utils";

export type SegmentOption = {
  id: string;
  /** Short — the cells are equal, so the longest label sets the row. */
  label: string;
  /** What choosing it means, shown under the row for the chosen one. */
  means?: string | null;
  /** Shown but not choosable (an agent this computer does not have). */
  disabled?: boolean;
  /** Why, on hover. */
  title?: string;
};

/**
 * Pick one of a few: equal cells in ONE row, what the chosen one means said
 * under it.
 *
 * It replaced rows of round chips that wrapped wherever their labels ran out
 * of room — on a phone "Low · Medium · High · Extra-high" on one line and
 * "Max" alone on the next, each pill as wide as its word, and nothing saying
 * why you would pick one over another (owner, 2026-10-19: "Frankenstein
 * elements … not sized, not symmetrical"). Equal cells cannot wrap unevenly,
 * and the sentence under the row is the reason to choose.
 *
 * A long label wraps inside its cell; every cell in a row grows with it, so
 * the row stays even. More than five choices do not fit a phone in one row:
 * pass `columns` (2, 3 or 4) for an even grid — four corners as 2 × 2, six
 * agents as 3 × 2, seven voices as 4 + 3 with the last cell two wide.
 */
export function Segmented({
  label,
  options,
  value,
  pending = null,
  onChange,
  columns,
}: {
  /** An even grid instead of one row. */
  columns?: 2 | 3 | 4;
  /** Names the group for a screen reader ("Effort"). */
  label: string;
  options: SegmentOption[];
  /** The choice in force, or null when it is not known. */
  value: string | null;
  /** A choice asked for and not yet confirmed: marked, and it pulses. */
  pending?: string | null;
  onChange: (id: string) => void;
}) {
  const shown = pending ?? value;
  const means = options.find((o) => o.id === shown)?.means;
  return (
    <div className="ui-segmented-wrap">
      <div
        className={cn(
          "ui-segmented",
          columns === 2 && "ui-segmented-cols-2",
          columns === 3 && "ui-segmented-cols-3",
          columns === 4 && "ui-segmented-cols-4",
        )}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((o) => {
          const on = o.id === shown;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.disabled}
              title={o.title}
              className={cn(
                on ? "ui-segment-active" : "ui-segment",
                pending === o.id && "animate-pulse",
              )}
              onClick={() => {
                if (o.id !== shown) onChange(o.id);
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {means && <p className="ui-sheet-hint">{means}</p>}
    </div>
  );
}
