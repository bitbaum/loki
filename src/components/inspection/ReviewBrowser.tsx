"use client";

import { useState } from "react";
import type { ReviewFrame } from "@/lib/inspection/contract";
import { RobotBrowser } from "./RobotBrowser";

/**
 * Loki's browser on the Review page: where it is and what it is doing over
 * the picture, the picture watched as RobotBrowser draws it (the pointer,
 * the press, leaning in on a phone). The same view the workbench shows —
 * one shape for one thing. Expanding lets a tall page run its full height.
 */
export function ReviewBrowser({ frame, live }: { frame: ReviewFrame; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ui-inspection-browser">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-3">
        <div className="min-w-0 text-sm text-text-secondary">
          <a href={frame.url} target="_blank" rel="noreferrer" className="ui-link block break-all">
            {new URL(frame.url).pathname}
          </a>
          <span className="mt-1 block" aria-live="polite">
            {frame.action}
          </span>
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
        aria-label="Loki's browser"
      >
        <RobotBrowser
          frame={frame}
          live={live}
          fit="width"
          label={`Browser view of ${frame.url} at ${frame.width}px, scrolled ${Math.round(frame.scrollY)}px`}
        />
      </div>
    </div>
  );
}
