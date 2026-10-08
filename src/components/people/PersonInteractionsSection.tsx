"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { CHANNEL_NAMES } from "@/config/channels";
import { APP_LOCALE } from "@/lib/constants";
import { EmptyState } from "@/components/ui/empty-state";
import { postJson } from "@/lib/api/fetch";
import { toLocalDateStr } from "@/lib/dates";
import { INTERACTION_DIRECTION, type InteractionDirection } from "@/lib/constants/statuses";
import { Section } from "./PersonDetailHelpers";
import type { Interaction } from "./person-detail-types";
import { DateInput } from "@/components/ui/date-input";

export function InteractionsSection({
  personId,
  interactions: list,
  onAdd,
}: {
  personId: string;
  interactions: Interaction[];
  onAdd: (ix: Interaction) => void;
}) {
  const [logging, setLogging] = useState(false);
  const [channel, setChannel] = useState(CHANNEL_NAMES[0] ?? "whatsapp");
  const [direction, setDirection] = useState<InteractionDirection>(INTERACTION_DIRECTION.OUTBOUND);
  const [summary, setSummary] = useState("");
  const [occurredAt, setOccurredAt] = useState(toLocalDateStr(new Date()));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleLog = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await postJson(`/api/people/${personId}/interactions`, {
        channel,
        direction,
        summary: summary || undefined,
        occurredAt,
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        onAdd({ channel, direction, summary: summary || null, occurredAt });
        setLogging(false);
        setSummary("");
      } else {
        setSaveError(data.error ?? "Failed to save");
      }
    } catch {
      setSaveError("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Recent Activity">
      {logging ? (
        <div className="mt-2 space-y-2 border-t border-border-subtle pt-3">
          <div className="flex gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="flex-1 ui-input-tight"
            >
              {CHANNEL_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as InteractionDirection)}
              className="ui-input-tight"
            >
              <option value={INTERACTION_DIRECTION.OUTBOUND}>→ out</option>
              <option value={INTERACTION_DIRECTION.INBOUND}>← in</option>
            </select>
          </div>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Brief note (optional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLog();
              if (e.key === "Escape") setLogging(false);
            }}
            autoFocus
            className="w-full ui-input-tight"
          />
          {saveError && <p className="ui-error-xs">{saveError}</p>}
          <div className="flex items-center gap-2">
            <DateInput
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="flex-1 ui-input-tight"
            />
            <button onClick={handleLog} disabled={saving} className="ui-btn-save">
              {saving ? <Loader2 className="ui-spinner-xs" /> : "Save"}
            </button>
            <button onClick={() => setLogging(false)} className="ui-link-subtle-button">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setLogging(true)} className="ui-btn-add mt-1">
          <Plus className="h-3.5 w-3.5" /> Log interaction
        </button>
      )}

      {list.length === 0 && !logging && <EmptyState>No interactions recorded</EmptyState>}
      {list.map((ix, i) => (
        <div key={i} className="ui-list-row space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs ${ix.direction === INTERACTION_DIRECTION.INBOUND ? "text-text-tertiary" : "text-status-positive/60"}`}
              >
                {ix.direction === INTERACTION_DIRECTION.INBOUND ? "←" : "→"}
              </span>
              <span className="text-text-secondary">{ix.channel}</span>
            </div>
            <span className="shrink-0 text-xs text-text-tertiary">
              {new Date(ix.occurredAt).toLocaleDateString(APP_LOCALE)}
            </span>
          </div>
          {ix.summary && <p className="text-xs text-text-tertiary leading-relaxed">{ix.summary}</p>}
        </div>
      ))}
    </Section>
  );
}
