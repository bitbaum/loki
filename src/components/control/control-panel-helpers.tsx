"use client";

import React from "react";
import { Bot } from "lucide-react";
import { getAdapterLabel } from "@/config/control-intents";
import { timeAgo } from "@/lib/dates";
import type { ControlData } from "@/lib/control-types";

type AgentEntry = ControlData["agentRegistry"]["agents"][number];
type TabResult = { status: string; tab?: string; reason?: string; error?: string };

export function BrainConfigPanel({
  selectedAgent,
  switchableRegistry,
  model,
  hasPendingChange,
  savingAgent,
  selectedDefinition,
  lastTabResults,
  lastTabResultsAt,
  onAgentSelect,
  onModelChange,
  onSave,
  onRequestInstall,
  headerRight,
}: {
  selectedAgent: string;
  switchableRegistry: AgentEntry[];
  model: string;
  hasPendingChange: boolean;
  savingAgent: boolean;
  selectedDefinition: AgentEntry | null;
  lastTabResults: TabResult[];
  lastTabResultsAt: number | null;
  onAgentSelect: (agentId: string, defaultModel: string | undefined) => void;
  onModelChange: (value: string) => void;
  onSave: (applyToOpenTabs: boolean) => void;
  onRequestInstall?: (agentId: string) => void;
  headerRight?: React.ReactNode;
}) {
  const modelSuggestions = selectedDefinition?.modelSuggestions ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="ui-kicker">Default agent for new launches</p>
          <div className="flex items-center gap-1.5 text-text-primary">
            <Bot className="h-3.5 w-3.5 shrink-0 text-accent-text" />
            <span className="text-sm font-semibold">
              {selectedDefinition?.label ?? getAdapterLabel(selectedAgent)}
            </span>
            <span className="text-xs text-text-tertiary">
              · {model || selectedDefinition?.defaultModel}
            </span>
          </div>
        </div>
        {headerRight && <div className="flex shrink-0 items-center gap-1.5">{headerRight}</div>}
      </div>

      <div className="flex flex-wrap gap-2">
        {switchableRegistry.map((entry) => {
          const isAvailable = entry.available ?? true;
          const isSelected = selectedAgent === entry.id;
          return (
            <div key={entry.id} className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => isAvailable && onAgentSelect(entry.id, entry.defaultModel)}
                disabled={!isAvailable}
                className={isSelected ? "ui-chip-toggle-active" : "ui-chip-toggle"}
                title={
                  isAvailable
                    ? `${entry.label} is available on the connected computer`
                    : (entry.availabilityReason ?? `${entry.label} is not available`)
                }
              >
                {entry.label}
                {!isAvailable && <span className="ml-1 text-micro opacity-60">(missing)</span>}
              </button>
              {!isAvailable && onRequestInstall && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestInstall(entry.id);
                  }}
                  className="ui-btn-ghost ui-btn-xs text-micro px-1.5 py-0.5"
                  title={`Install ${entry.label} — opens a terminal tab with the installer`}
                >
                  Install
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          {/* Model suggestions come strictly from the registry for the selected agent.
              Chips are quick picks; the input allows any custom value (with datalist for convenience). */}
          <div className="flex flex-wrap gap-1 items-center">
            {modelSuggestions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onModelChange(option)}
                className={
                  model === option ? "ui-chip-toggle-compact-active" : "ui-chip-toggle-compact"
                }
              >
                {option}
              </button>
            ))}
          </div>
          <input
            list={`model-options-${selectedAgent}`}
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="ui-input min-w-0 text-sm py-1"
            placeholder={selectedDefinition?.defaultModel ?? "Model (or type custom)"}
          />
          <datalist id={`model-options-${selectedAgent}`}>
            {modelSuggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>

        {/* Save actions only appear when something changed. The "New project"
            button that used to fill this slot duplicated the header's "+ New"
            CTA in the least discoverable spot on the page (inside a collapsed
            accordion at the bottom) — removed 2026-08-13. */}
        {hasPendingChange && (
          <div className="flex flex-wrap items-start gap-2 lg:justify-end">
            <button
              onClick={() => onSave(false)}
              disabled={savingAgent || !model.trim()}
              className="ui-btn-secondary"
            >
              Save
            </button>
            <button
              onClick={() => onSave(true)}
              disabled={savingAgent || !model.trim()}
              className="ui-btn-primary"
            >
              {savingAgent ? "…" : "Apply to open tabs"}
            </button>
          </div>
        )}
      </div>

      {lastTabResults.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-surface-overlay px-3 py-1.5 text-micro text-text-tertiary">
          Last switch{lastTabResultsAt ? ` · ${timeAgo(lastTabResultsAt)}` : ""}:{" "}
          {lastTabResults.slice(0, 3).map((r, i) => (
            <span key={i}>
              {r.tab ? `${r.tab} ${r.status}` : r.status}
              {r.error ? ` (${r.error})` : ""}
              {i < Math.min(lastTabResults.length, 3) - 1 ? ", " : ""}
            </span>
          ))}
          {lastTabResults.some((r) => r.status === "queued") && (
            <span className="ml-1 text-text-muted">· runner picks up within ~25s</span>
          )}
        </div>
      )}
    </div>
  );
}
