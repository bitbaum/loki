"use client";

import { useId, useState } from "react";
import { ChevronDown, Share2 } from "lucide-react";

export type ShareDestination = {
  key: string;
  /** Where it goes, in the owner's words. */
  title: string;
  /** What choosing it actually does — the difference between these is the point. */
  explain: string;
  /** The existing control for it, unchanged. */
  control: React.ReactNode;
};

/**
 * One door for "take this project somewhere public".
 *
 * The header used to lay four of them side by side — List publicly, Publish,
 * Govern, Share — as peers of Live and Repository, with nothing saying how
 * they differ. George called the row a Frankenstein (2026-09-25), and reading
 * it cold it is: four verbs for what looks like one idea. They are not one
 * idea (a catalogue listing, an OrangeCat page, a Solon venture, a private
 * link), so they get one button and a line each that says which is which.
 */
export function ProjectShareMenu({ destinations }: { destinations: ShareDestination[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const shown = destinations.filter((d) => d.control);
  if (shown.length === 0) return null;
  return (
    <div className="w-full">
      <button
        type="button"
        className="ui-btn-ghost min-h-11 gap-1.5"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Share &amp; publish
        <ChevronDown
          className={
            open ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"
          }
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul id={panelId} className="ui-card-shell mt-2 divide-y divide-border-subtle">
          {shown.map((d) => (
            <li
              key={d.key}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{d.title}</p>
                <p className="text-sm text-text-secondary">{d.explain}</p>
              </div>
              <div className="shrink-0">{d.control}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
