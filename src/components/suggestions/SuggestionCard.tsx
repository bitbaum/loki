"use client";

import { ArrowUpRight, Check, type LucideIcon } from "lucide-react";
import { LIFE_KIND_ICON } from "@/config/suggestion-avenues";
import { BUILD_KIND_ICON } from "@/components/loki/BuildSuggestions";
import type { Suggestion } from "@/lib/suggestions/types";

const KIND_ICON = { ...BUILD_KIND_ICON, ...LIFE_KIND_ICON } satisfies Record<
  Suggestion["kind"],
  LucideIcon
>;

/**
 * One suggestion: the thing to do, the stored fact it came from, and two
 * answers. "Do it" hands it to Loki (or opens where it is done); "Not now"
 * puts it away for a while. The card never names its avenue: it always sits
 * under its avenue's heading, in the "All" view and the filtered one alike.
 */
export function SuggestionCard({
  suggestion,
  onTake,
  onDismiss,
}: {
  suggestion: Suggestion;
  onTake: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
}) {
  const Icon = KIND_ICON[suggestion.kind];
  const opens = Boolean(suggestion.href);
  return (
    <li className="ui-sugg-card">
      <div className="ui-sugg-card-top">
        <Icon className="ui-loki-build-icon mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="ui-sugg-card-label">{suggestion.label}</div>
          <p className="ui-sugg-card-why">{suggestion.why}</p>
        </div>
      </div>
      <div className="ui-sugg-card-actions">
        <button type="button" className="ui-btn-primary" onClick={() => onTake(suggestion)}>
          {opens ? (
            <>
              Open
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </>
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden />
              Do it
            </>
          )}
        </button>
        <button type="button" className="ui-btn-ghost" onClick={() => onDismiss(suggestion)}>
          Not now
        </button>
      </div>
    </li>
  );
}
