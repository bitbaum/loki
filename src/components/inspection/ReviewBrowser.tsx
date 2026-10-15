"use client";
/* eslint-disable @next/next/no-img-element -- Private, already-compressed browser evidence. */
import { useState } from "react";
import type { ReviewFrame } from "@/lib/inspection/contract";

/** Keep the actual page readable on a phone; expansion is optional. */
export function ReviewBrowser({ frame }: { frame: ReviewFrame }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ui-inspection-browser">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-3">
        <div className="min-w-0 text-sm text-text-secondary">
          <a href={frame.url} target="_blank" rel="noreferrer" className="ui-link block break-all">
            {new URL(frame.url).pathname}
          </a>
          <span className="mt-1 block">{frame.action}</span>
        </div>
        <button
          type="button"
          className="ui-btn-ghost min-h-11 shrink-0 text-sm"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Reduce view" : "Expand view"}
        </button>
      </div>
      <div
        className="ui-inspection-viewport"
        data-expanded={expanded || undefined}
        tabIndex={0}
        aria-label="Captured browser viewport"
      >
        <img
          src={frame.image}
          width={frame.width}
          height={frame.height}
          alt={`Browser view of ${frame.url} at ${frame.width}px, scrolled ${Math.round(frame.scrollY)}px`}
          className="mx-auto block h-auto w-full"
        />
      </div>
    </div>
  );
}
