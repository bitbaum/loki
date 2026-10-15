"use client";

// Per-project autopilot play/pause.
//
// Pre-v0.7: a single user-level beacon_settings.auto_inject_mode applied to
// every project. Users dogfooding multi-project flows wanted a way to pause
// autopilot on one project without disabling it everywhere ("globally on is
// fine, but I'm in the middle of something fragile in this repo and the loop
// fires would be noise").
//
// This control writes/clears entities.auto_inject_mode_override. Media-player
// semantics: the button shows the action a click will take (pause icon while
// building, play icon while paused). Clicking toggles the *effective* state;
// when the toggle would land back on the inherited global mode we clear the
// override instead of storing a redundant one, so "inherit" stays the default
// and the override count on the fleet hint only reflects real divergence.

import { useProjectAutopilot } from "@/hooks/use-project-autopilot";
import { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import { LOKI_REFRESH_EVENT } from "@/lib/client-events";
import type { AutoInjectMode } from "@/config/beacon";
import { cn } from "@/lib/utils";

export interface ProjectAutopilotToggleProps {
  /** Entity id (UUID) of the project. Required for the PATCH endpoint. */
  projectId: string | null;
  /** Current per-project override, or null if inheriting the user default. */
  currentOverride: AutoInjectMode | null;
  /** The user-level mode this project would inherit if no override is set. */
  inheritedMode: AutoInjectMode;
  /** Compact chip for project rail rows; default is full card control. */
  variant?: "card" | "rail";
  /** Called after a successful PATCH so the parent can refetch /api/control. */
  onAfter?: () => void;
  onOverrideChange?: (override: AutoInjectMode | null) => void;
}

export function ProjectAutopilotToggle({
  projectId,
  currentOverride,
  inheritedMode,
  variant = "card",
  onAfter,
  onOverrideChange,
}: ProjectAutopilotToggleProps) {
  const {
    override: localOverride,
    setOverride: setLocalOverride,
    effectiveMode,
  } = useProjectAutopilot(currentOverride, inheritedMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!projectId) return null;

  const building = effectiveMode === "on";
  const overridden = localOverride !== null;

  async function saveOverride(nextOverride: AutoInjectMode | null) {
    setSaving(true);
    setError(null);
    const previous = localOverride;
    setLocalOverride(nextOverride);
    onOverrideChange?.(nextOverride);
    try {
      const res = await patchJson(`/api/projects/${projectId}`, {
        autoInjectModeOverride: nextOverride,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        setLocalOverride(previous);
        onOverrideChange?.(previous);
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(LOKI_REFRESH_EVENT));
      }
      onAfter?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLocalOverride(previous);
      onOverrideChange?.(previous);
    } finally {
      setSaving(false);
    }
  }

  function toggle() {
    const target: AutoInjectMode = building ? "off" : "on";
    saveOverride(target === inheritedMode ? null : target);
  }

  const tooltip = building
    ? `Autopilot is on for this project${overridden ? " (project override)" : " (following fleet: on)"}. Pause this project.`
    : `Autopilot is paused for this project${overridden ? " (project override)" : " (following fleet: off)"}. Resume this project.`;

  if (variant === "rail") {
    if (!overridden && building) return null;
    return (
      <span
        className={cn(
          "ui-control-project-autopilot-paused",
          building && overridden && "text-accent-text normal-case tracking-normal",
        )}
        title={tooltip}
      >
        {/* A bare "On" beside a project name did not say WHAT was on. */}
        {building ? "Autopilot" : "Paused"}
      </span>
    );
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        aria-pressed={building}
        title={tooltip}
        disabled={saving}
        onClick={toggle}
        className={cn(
          "inline-flex ui-tap items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60",
          building ? "ui-btn-secondary" : "ui-btn-primary",
        )}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-hidden="true" />
        ) : building ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
        {building && (
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-primary"
          />
        )}
        {/* Say what the control IS, not a state word. "Building" next to the
            card's own state badge ("Awaiting input") read as two contradicting
            statuses — this is the autopilot toggle, so name it that. */}
        <span>{building ? "Autopilot on" : "Autopilot paused"}</span>
      </button>
      {overridden && (
        <button
          type="button"
          disabled={saving}
          onClick={() => saveOverride(null)}
          className="ui-btn-chip text-micro disabled:opacity-60"
          title={`Follow fleet autopilot again (currently: ${inheritedMode === "on" ? "building" : "paused"}).`}
        >
          Follow fleet
        </button>
      )}
      {error && <span className="text-xs text-status-warning">{error}</span>}
    </div>
  );
}
