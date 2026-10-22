"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { CHANNEL_NAMES } from "@/config/channels";
import { APP_LOCALE } from "@/lib/constants";
import { EmptyState } from "@/components/ui/empty-state";
import { postJson } from "@/lib/api/fetch";
import { toLocalDateStr } from "@/lib/dates";
import { INTERACTION_DIRECTION, type InteractionDirection } from "@/lib/constants/statuses";
import { Section, ChannelIcon, channelLabel } from "./PersonDetailHelpers";
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
    <Section title="Conversations">
      {logging ? (
        <div className="mt-2 space-y-2 border-t border-border-subtle pt-3">
          <div className="flex gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="flex-1 ui-input"
            >
              {CHANNEL_NAMES.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as InteractionDirection)}
              className="ui-input"
            >
              <option value={INTERACTION_DIRECTION.OUTBOUND}>You got in touch</option>
              <option value={INTERACTION_DIRECTION.INBOUND}>They got in touch</option>
            </select>
          </div>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What about? (optional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLog();
              if (e.key === "Escape") setLogging(false);
            }}
            autoFocus
            className="w-full ui-input"
          />
          {saveError && <p className="ui-error-xs">{saveError}</p>}
          <div className="flex items-center gap-2">
            <DateInput
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="flex-1 ui-input"
            />
            <button onClick={handleLog} disabled={saving} className="ui-btn-secondary">
              {saving ? <Loader2 className="ui-spinner-xs" /> : "Save"}
            </button>
            <button onClick={() => setLogging(false)} className="ui-link-subtle-button">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setLogging(true)} className="ui-life-add">
          <Plus className="h-4 w-4" /> Log a conversation
        </button>
      )}

      {list.length === 0 && !logging && <EmptyState>No conversations logged yet.</EmptyState>}
      {list.map((ix, i) => (
        <div key={i} className="ui-person-row">
          <ChannelIcon channel={ix.channel} />
          <div className="min-w-0 flex-1 py-2">
            <div className="text-text-primary">
              {ix.direction === INTERACTION_DIRECTION.INBOUND
                ? "They got in touch"
                : "You got in touch"}
              <span className="text-text-secondary"> · {channelLabel(ix.channel)}</span>
            </div>
            {ix.summary && (
              <p className="text-sm leading-relaxed text-text-secondary">{ix.summary}</p>
            )}
          </div>
          <span className="shrink-0 self-start pt-2.5 text-meta text-text-tertiary">
            {new Date(ix.occurredAt).toLocaleDateString(APP_LOCALE)}
          </span>
        </div>
      ))}
    </Section>
  );
}
