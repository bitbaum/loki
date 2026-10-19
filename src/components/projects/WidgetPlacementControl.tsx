"use client";

import { useState } from "react";
import { Loader2, MoveDiagonal } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import {
  WIDGET_CORNERS,
  WIDGET_CORNER_LABELS,
  WIDGET_OFFSET_MAX,
  WIDGET_OFFSET_MIN,
  WIDGET_PLACEMENT_DEFAULT,
  isDefaultPlacement,
  normalizeWidgetPlacement,
  type WidgetCorner,
  type WidgetPlacement,
} from "@/config/widget-placement";

/**
 * Move the launcher on a customer's live site without touching their HTML.
 *
 * Every mainstream chat widget parks itself bottom-right, same as ours, and our
 * near-maximum z-index means we cover theirs. Before this control the only fix
 * was a `data-fc-bottom` attribute in the customer's markup — impossible on a
 * site we do not deploy, and not something anyone would find.
 *
 * The preview is the point. "bottom-left, 16, 16" is not a thing anyone can
 * picture; a box with a dot in the corner is. It is rendered from the SAME
 * values that get saved, so what you see is what the boot call will serve.
 */
export function WidgetPlacementControl({
  value,
  onSave,
  busy,
}: {
  value: unknown;
  onSave: (placement: WidgetPlacement) => Promise<void> | void;
  busy?: boolean;
}) {
  const saved = normalizeWidgetPlacement(value);
  const [draft, setDraft] = useState<WidgetPlacement>(saved);
  const dirty =
    draft.corner !== saved.corner ||
    draft.offsetX !== saved.offsetX ||
    draft.offsetY !== saved.offsetY ||
    draft.autoAvoid !== saved.autoAvoid;

  const set = (patch: Partial<WidgetPlacement>) => setDraft((d) => ({ ...d, ...patch }));

  // Preview box is 100x64; map the real px offset onto it so a large nudge
  // visibly moves the dot instead of all values looking identical.
  const previewPos = (corner: WidgetCorner, ox: number, oy: number) => {
    const fx = Math.min(38, (ox / WIDGET_OFFSET_MAX) * 38);
    const fy = Math.min(24, (oy / WIDGET_OFFSET_MAX) * 24);
    return {
      left: corner.endsWith("left") ? `${4 + fx}px` : undefined,
      right: corner.endsWith("right") ? `${4 + fx}px` : undefined,
      top: corner.startsWith("top") ? `${4 + fy}px` : undefined,
      bottom: corner.startsWith("bottom") ? `${4 + fy}px` : undefined,
    };
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-2">
        <MoveDiagonal className="h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
        <span className="ui-micro-label">Launcher position</span>
        {isDefaultPlacement(saved) && <span className="ui-badge">Default</span>}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* Preview */}
        <div
          className="relative h-16 w-24 shrink-0 rounded-md border border-border-default bg-surface-overlay"
          aria-hidden="true"
        >
          <span
            className="absolute h-2.5 w-2.5 rounded-full bg-accent-primary"
            style={previewPos(draft.corner, draft.offsetX, draft.offsetY)}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <Segmented
            label="Launcher corner"
            columns={2}
            options={WIDGET_CORNERS.map((c) => ({ id: c, label: WIDGET_CORNER_LABELS[c] }))}
            value={draft.corner}
            onChange={(c) => set({ corner: c as (typeof WIDGET_CORNERS)[number] })}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              Side
              <input
                type="number"
                min={WIDGET_OFFSET_MIN}
                max={WIDGET_OFFSET_MAX}
                value={draft.offsetX}
                onChange={(e) => set({ offsetX: Number(e.target.value) })}
                className="ui-input-tight w-16"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              Up
              <input
                type="number"
                min={WIDGET_OFFSET_MIN}
                max={WIDGET_OFFSET_MAX}
                value={draft.offsetY}
                onChange={(e) => set({ offsetY: Number(e.target.value) })}
                className="ui-input-tight w-16"
              />
            </label>
            <span className="text-micro text-text-muted">px</span>
          </div>

          <label className="flex items-start gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={draft.autoAvoid}
              onChange={(e) => set({ autoAvoid: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Step aside automatically
              <span className="block text-micro text-text-muted">
                If a chat or support button already sits in that corner, the launcher moves up to
                clear it. Turn off to keep it exactly where you put it.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => onSave(normalizeWidgetPlacement(draft))}
          className="ui-btn-save gap-1.5"
        >
          {busy ? <Loader2 className="ui-spinner-xs" /> : null}
          Save position
        </button>
        {dirty && (
          <button type="button" onClick={() => setDraft(saved)} className="ui-btn-ghost text-xs">
            Cancel
          </button>
        )}
        {!isDefaultPlacement(draft) && (
          <button
            type="button"
            onClick={() => setDraft({ ...WIDGET_PLACEMENT_DEFAULT })}
            className="ui-btn-ghost text-xs text-text-tertiary"
          >
            Reset to default
          </button>
        )}
      </div>
      <p className="text-micro text-text-muted">
        Takes effect on the live site within about a minute — no code change on their end.
      </p>
    </div>
  );
}
