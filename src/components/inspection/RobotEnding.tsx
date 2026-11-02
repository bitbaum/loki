"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { pagesSeen, walkEnding } from "@/lib/inspection/robot-view";

/**
 * The end of a walk Loki took while you watched: a check that draws
 * itself, one warm sentence, and the one next step. Nothing found is said
 * as the good news it is; something found is one tap away. It stays until
 * it is closed — an ending that vanishes on a timer is one people miss.
 */
export function RobotEnding({
  coverage,
  findings,
  reviewHref,
  onClose,
}: {
  coverage: readonly { url: string; result: string }[];
  findings: number;
  reviewHref: string;
  onClose: () => void;
}) {
  const ending = walkEnding(Math.max(1, pagesSeen(coverage)), findings);
  return (
    <div className="ui-robot-ending" role="status">
      <p className="ui-robot-ending-title mb-0">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path
            className="ui-robot-ending-check"
            d="M5 12.5l4.5 4.5L19 7.5"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="flex-1">{ending.title}</span>
        <button type="button" className="ui-term-pane-btn" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </p>
      <p className="mb-0 text-sm text-text-secondary">{ending.detail}</p>
      {findings > 0 && (
        <Link href={reviewHref} className="ui-btn-primary ui-btn-sm self-start">
          See what Loki found
        </Link>
      )}
    </div>
  );
}
