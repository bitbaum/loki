"use client";

import type { LucideIcon } from "lucide-react";
import { LIFE_KIND_ICON } from "@/config/suggestion-avenues";
import { BUILD_KIND_ICON } from "@/components/loki/BuildSuggestions";
import { ListRow } from "@/components/ui/list-row";
import { RowActions } from "@/components/ui/row-actions";
import type { Suggestion } from "@/lib/suggestions/types";

const KIND_ICON = { ...BUILD_KIND_ICON, ...LIFE_KIND_ICON } satisfies Record<
  Suggestion["kind"],
  LucideIcon
>;

/**
 * One suggestion, as one row (design reset rule 3): the thing to do, the
 * stored fact it came from on the grey line, and ONE action — the row itself,
 * which hands it to Loki or opens where it is done. "Not now" is in the row's
 * own menu. It was a bordered card with a black "Review task" button and a
 * "Not now" beside it, repeated down the page.
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
  return (
    <ListRow
      icon={KIND_ICON[suggestion.kind]}
      title={suggestion.label}
      secondary={suggestion.why}
      onClick={() => onTake(suggestion)}
      menu={
        <RowActions label={`More for: ${suggestion.label}`}>
          <button
            type="button"
            role="menuitem"
            className="ui-menu-item"
            onClick={() => onDismiss(suggestion)}
          >
            Not now
          </button>
        </RowActions>
      }
    />
  );
}
