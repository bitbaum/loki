"use client";

import { useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { setAttr, removeAttr } from "@/lib/api/attrs";
import { throwApiError } from "@/lib/api/fetch";
import { CHANNEL_NAMES, isChannelAttrKey, withChannelPrefix } from "@/config/channels";
import { EmptyState } from "@/components/ui/empty-state";
import { Section, ChannelIcon, channelLabel } from "./PersonDetailHelpers";
import { formatChannelValue } from "./person-detail-types";
import { channelHref } from "@/lib/people-reach";
import { TOAST_SHORT_MS } from "@/lib/constants/timings";

export function ChannelsSection({
  personId,
  attrs,
  onUpdate,
}: {
  personId: string;
  attrs: Record<string, string>;
  onUpdate: (updated: Record<string, string>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [channelType, setChannelType] = useState(CHANNEL_NAMES[0] ?? "whatsapp");
  const [channelValue, setChannelValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const channels = Object.entries(attrs).filter(([k]) => isChannelAttrKey(k));

  const saveChannel = async () => {
    if (!channelValue.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    const key = withChannelPrefix(channelType);
    try {
      const res = await setAttr(`/api/people/${personId}`, key, channelValue.trim());
      if (!res.ok) await throwApiError(res, "Failed to save");
      onUpdate({ ...attrs, [key]: channelValue.trim() });
      setChannelValue("");
      setAdding(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const deleteChannel = async (key: string) => {
    setDeletingKey(key);
    setSaveError(null);
    try {
      const res = await removeAttr(`/api/people/${personId}`, key);
      if (res.ok) {
        const next = { ...attrs };
        delete next[key];
        onUpdate(next);
      } else {
        setSaveError("Failed to remove — try again");
        setTimeout(() => setSaveError(null), TOAST_SHORT_MS);
      }
    } catch {
      setSaveError("Network error — try again");
      setTimeout(() => setSaveError(null), TOAST_SHORT_MS);
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <Section title="Reach them">
      {channels.map(([key, value]) => (
        <div key={key} className="group flex items-center gap-3 ui-person-row">
          <ChannelIcon channel={key} />
          <span className="shrink-0 text-text-secondary">{channelLabel(key)}</span>
          {(() => {
            // Same treatment as Today's check-in row: a contact value the
            // operator has to select and copy is not a contact method. One
            // shared builder, so the two surfaces cannot drift on which
            // schemes are safe to open.
            const shown = formatChannelValue(value);
            const href = channelHref(key, shown);
            const cls = "flex-1 truncate text-text-secondary";
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`${cls} underline decoration-dotted underline-offset-2 hover:text-accent-text`}
                title={shown}
              >
                {shown}
              </a>
            ) : (
              <span className={cls} title={shown}>
                {shown}
              </span>
            );
          })()}
          <button
            onClick={() => deleteChannel(key)}
            disabled={deletingKey === key}
            className="shrink-0 ui-hover-reveal ui-btn-icon"
          >
            {deletingKey === key ? (
              <Loader2 className="ui-spinner-sm" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </button>
        </div>
      ))}
      {channels.length === 0 && !adding && (
        <EmptyState>No email, phone or chat on file.</EmptyState>
      )}
      {adding ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <select
              value={channelType}
              onChange={(e) => setChannelType(e.target.value)}
              className="ui-input shrink-0"
            >
              {CHANNEL_NAMES.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
            <input
              value={channelValue}
              onChange={(e) => {
                setChannelValue(e.target.value);
                setSaveError(null);
              }}
              placeholder="handle or number"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveChannel();
                if (e.key === "Escape") {
                  setAdding(false);
                  setChannelValue("");
                  setSaveError(null);
                }
              }}
              autoFocus
              className="flex-1 min-w-0 ui-input"
            />
            <button
              onClick={saveChannel}
              disabled={!channelValue.trim() || saving}
              className="ui-btn-icon-accent p-1.5"
            >
              {saving ? <Loader2 className="ui-spinner-xs" /> : <Save className="h-3 w-3" />}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setChannelValue("");
                setSaveError(null);
              }}
              className="ui-btn-icon"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {saveError && <p className="ui-error-xs">{saveError}</p>}
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="ui-life-add">
          <Plus className="h-4 w-4" /> Add a way to reach them
        </button>
      )}
    </Section>
  );
}
