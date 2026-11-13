"use client";

import { Loader2, Pause, Play } from "lucide-react";
import type { AutoInjectMode } from "@/config/beacon";
import { cn } from "@/lib/utils";

/**
 * Fleet-wide play/pause. Media-player semantics: shows the action a click
 * will take. Hero variant uses ui-control-autopilot-* for the /control
 * mission-control card; compact variant fits inline toolbars.
 */
const MODE_TOOLTIP: Record<AutoInjectMode, string> = {
  off: "Fleet paused — Loki dispatches nothing. Click to start building: agents work through each project's queue, then pick the next-best task automatically.",
  on: "Fleet building — when an agent finishes, Loki sends the next queued instruction (or picks the next-best task if the queue is empty). Click to pause all dispatching.",
};

export function AutomationPolicyControl({
  mode,
  saving,
  onChange,
  variant = "hero",
}: {
  mode: AutoInjectMode;
  saving: boolean;
  onChange: (mode: AutoInjectMode) => void;
  variant?: "hero" | "compact";
}) {
  const building = mode === "on";

  if (variant === "compact") {
    return (
      <button
        type="button"
        aria-pressed={building}
        title={MODE_TOOLTIP[mode]}
        disabled={saving}
        onClick={() => onChange(building ? "off" : "on")}
        className={cn(
          building ? "ui-btn-secondary" : "ui-btn-primary",
          "gap-1.5 px-3 py-1.5 text-xs",
        )}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : building ? (
          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {building && (
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-primary"
          />
        )}
        {building ? "Pause all" : "Build all"}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={building}
      title={MODE_TOOLTIP[mode]}
      disabled={saving}
      onClick={() => onChange(building ? "off" : "on")}
      className={building ? "ui-control-autopilot-btn-pause" : "ui-control-autopilot-btn-build"}
    >
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : building ? (
        <Pause className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Play className="h-4 w-4" aria-hidden="true" />
      )}
      {building && (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent-primary"
        />
      )}
      {building ? "Pause all building" : "Start building"}
    </button>
  );
}
