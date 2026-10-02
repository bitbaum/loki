"use client";

import { useState } from "react";
import type { PersonWithAttributes } from "@/db/queries/people";
import { CHANNEL_CONFIG, CHANNEL_NAMES, isChannelAttrKey } from "@/config/channels";
import { HEALTH_DOT_COLOR } from "@/lib/constants/people";
import { Link2, Plus, Check, Loader2 } from "lucide-react";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { RowActions } from "@/components/ui/row-actions";
import { formatDistanceToNow } from "date-fns";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { INTERACTION_DIRECTION, type InteractionDirection } from "@/lib/constants/statuses";
import { FEEDBACK_SHORT_MS } from "@/lib/constants/timings";

export function PersonCard({
  person,
  onClick,
  onLogged,
}: {
  person: PersonWithAttributes;
  onClick: () => void;
  onLogged?: (personId: string, at: Date) => void;
}) {
  const channels = Object.keys(person.attrs).filter(isChannelAttrKey);
  const profession = person.attrs["profession"] ?? person.attrs["role"] ?? person.attrs["company"];
  const location = person.attrs["location"] ?? person.attrs["home_location"];
  let aliasHint = "";
  try {
    const raw = person.attrs.aliases;
    const aliases = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(aliases)) {
      // An alias made of words already in the displayed name tells the reader
      // nothing. This filter only excluded an alias equal to the WHOLE name, so
      // a person stored with ["Manuel", "Riegner"] rendered as
      // "Manuel Riegner" with "Manuel · Riegner" directly beneath it — the name
      // again, split up, presented as if it were extra information. Across a
      // 2,749-person book that is a duplicated line on most rows.
      const nameTokens = new Set(
        person.name
          .toLowerCase()
          .split(/[\s,]+/)
          .filter(Boolean),
      );
      aliasHint = aliases
        .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        .filter((a) => {
          const norm = a.trim().toLowerCase();
          if (norm === person.name.toLowerCase()) return false;
          // Every word of the alias already appears in the name → adds nothing.
          const words = norm.split(/[\s,]+/).filter(Boolean);
          return !words.every((w) => nameTokens.has(w));
        })
        .slice(0, 2)
        .join(" · ");
    }
  } catch {
    /* stored as plain text */
  }

  const quickChannel = channels[0] ?? CHANNEL_NAMES[0] ?? "other";

  const lokiPrompt = [
    `Person: ${person.name}`,
    profession && `Role: ${profession}`,
    location && `Location: ${location}`,
    person.description && `Notes: ${person.description}`,
    person.lastInteraction
      ? `Last contact: ${formatDistanceToNow(person.lastInteraction, { addSuffix: true })} (${person.interactionCount} interactions)`
      : "No recorded interactions",
    "",
    "What do you know about this person from my knowledge graph? What would be a good next step with them?",
  ]
    .filter(Boolean)
    .join("\n");

  const [logOpen, setLogOpen] = useState(false);
  const [channel, setChannel] = useState(CHANNEL_NAMES[0] ?? "whatsapp");
  const [direction, setDirection] = useState<InteractionDirection>(INTERACTION_DIRECTION.OUTBOUND);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [quickDone, setQuickDone] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  async function submitQuick(e: React.MouseEvent) {
    e.stopPropagation();
    setQuickSaving(true);
    const occurredAt = new Date();
    try {
      const res = await postJson(`/api/people/${person.id}/interactions`, {
        channel: quickChannel,
        direction: INTERACTION_DIRECTION.OUTBOUND,
      });
      if (!res.ok) return;
      setQuickDone(true);
      onLogged?.(person.id, occurredAt);
      setTimeout(() => setQuickDone(false), FEEDBACK_SHORT_MS);
    } finally {
      setQuickSaving(false);
    }
  }

  async function submitLog(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setSaving(true);
    setLogError(null);
    const occurredAt = new Date();
    try {
      const res = await postJson(`/api/people/${person.id}/interactions`, {
        channel,
        direction,
        summary: summary.trim() || undefined,
      });
      if (!res.ok) await throwApiError(res, "Failed to log");
      setDone(true);
      setSummary("");
      onLogged?.(person.id, occurredAt);
      setTimeout(() => {
        setDone(false);
        setLogOpen(false);
      }, 1200);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function openLog(e: React.MouseEvent) {
    e.stopPropagation();
    setLogOpen(true);
  }

  function cancelLog(e: React.MouseEvent) {
    e.stopPropagation();
    setLogOpen(false);
    setSummary("");
    setDone(false);
    setLogError(null);
  }

  return (
    // One row per person: a 2,749-person book drawn as tall cards (name, a
    // second row of actions, generous padding) showed about five people per
    // phone screen and ran to 9,000px for a fraction of the list (2026-10-01).
    <div className="ui-card-shell group w-full transition-colors hover:bg-surface-raised">
      <div className="flex items-center gap-2 pr-2">
        <button onClick={onClick} className="min-w-0 flex-1 px-3 py-2.5 text-left">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT_COLOR[person.health]}`}
              title={`${person.health}${person.lastInteraction ? ` — last ${formatDistanceToNow(person.lastInteraction, { addSuffix: true })}` : ""}`}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text-primary" title={person.name}>
                {person.name}
              </div>
              <div className="flex min-w-0 items-center gap-x-1.5 text-xs text-text-tertiary">
                <span
                  className="truncate"
                  title={[profession, location, aliasHint].filter(Boolean).join(" · ")}
                >
                  {[
                    profession,
                    location,
                    person.lastInteraction
                      ? formatDistanceToNow(person.lastInteraction, { addSuffix: true })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {person.relationCount > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-accent-text">
                    <Link2 className="h-3 w-3" aria-hidden />
                    {person.relationCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          {channels.map((ch) => {
            const config = CHANNEL_CONFIG[ch];
            if (!config) return null;
            const Icon = config.icon;
            return (
              <span key={ch} title={config.label}>
                <Icon className={`h-4 w-4 ${config.color}`} />
              </span>
            );
          })}
        </div>

        {!logOpen && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={submitQuick}
              disabled={quickSaving || quickDone}
              className="opacity-100 transition-opacity sm:opacity-70 sm:group-hover:opacity-100 ui-btn-chip disabled:opacity-40"
              title={`Log outbound via ${quickChannel}`}
            >
              {quickDone ? (
                <>
                  <Check className="h-3 w-3 text-status-positive" /> Logged
                </>
              ) : quickSaving ? (
                <>
                  <Loader2 className="ui-spinner-xs" /> …
                </>
              ) : (
                <>Log talk</>
              )}
            </button>
            {/* "Log talk" is the one-tap action and stays; the other two are the
              same job at other fidelities — a detailed log, or handing the
              person to Loki — so they sit behind one trigger. Three controls
              per card, across 2,749 cards, is a lot of deciding for a list you
              scroll. The log form still opens in the CARD, not in the menu, so
              closing the menu on choose is the right behaviour here. */}
            <RowActions label={`More actions for ${person.name}`}>
              <LokiDispatchButton
                prompt={lokiPrompt}
                title="Ask Loki about this person"
                label="Ask Loki about this person"
                className="ui-menu-item"
              />
              <button onClick={openLog} className="ui-menu-item" role="menuitem">
                <Plus className="h-3 w-3 shrink-0" />
                Log with details
              </button>
            </RowActions>
          </div>
        )}
      </div>

      {logOpen && (
        <div
          className="mt-0 space-y-3 border-t border-border-subtle px-4 pb-4 pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {done ? (
            <div className="flex items-center gap-1.5 text-sm text-status-positive">
              <Check className="h-3.5 w-3.5" /> Logged
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="ui-input-tight"
                >
                  {CHANNEL_NAMES.map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
                <div className="flex overflow-hidden rounded-xl border border-border-default bg-surface-overlay text-xs">
                  {([INTERACTION_DIRECTION.OUTBOUND, INTERACTION_DIRECTION.INBOUND] as const).map(
                    (d) => (
                      <button
                        key={d}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDirection(d);
                        }}
                        className={`px-3 py-1.5 transition-colors ${
                          direction === d
                            ? "bg-accent-muted text-accent-text"
                            : "text-text-tertiary hover:text-text-primary"
                        }`}
                      >
                        {d === INTERACTION_DIRECTION.OUTBOUND ? "out" : "in"}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitLog(e);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setLogOpen(false);
                    setSummary("");
                  }
                }}
                placeholder="Optional note..."
                autoFocus
                className="w-full ui-input-compact"
              />
              {logError && <p className="ui-error-xs">{logError}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={submitLog}
                  disabled={saving}
                  className="flex items-center gap-1 rounded-xl bg-accent-primary px-3 py-2 text-xs font-medium text-text-inverted transition-colors hover:bg-accent-hover disabled:opacity-30"
                >
                  {saving ? <Loader2 className="ui-spinner-xs" /> : <Check className="h-3 w-3" />}
                  Log
                </button>
                <button onClick={cancelLog} className="ui-link-subtle">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
