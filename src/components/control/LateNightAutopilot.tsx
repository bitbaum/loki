"use client";

import { useEffect, useState } from "react";
import { Loader2, Moon, X } from "lucide-react";
import { useAutomationPolicy } from "@/hooks/use-automation-policy";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { isLateNight, lateNightCopy, nightKey } from "@/lib/late-night";

const DISMISSED_KEY = "loki:late-night-dismissed";
const CLOCK_MS = 5 * 60 * 1000;

/**
 * After 23:00 local time, Control says what a person at a laptop at midnight
 * needs to hear: go to sleep, autopilot has it — with the switch one tap away
 * when it is off. "Not tonight" hides it until the next evening.
 *
 * Renders nothing in the day, nothing before the server has said what the
 * autopilot setting is (it would otherwise offer to turn on something already
 * on), and nothing on the server: the hour is the reader's, not the box's.
 */
export function LateNightAutopilot() {
  const policy = useAutomationPolicy();
  const [now, setNow] = useState<Date | null>(null);
  const [dismissed, setDismissed] = useLocalStorageState<string>(
    DISMISSED_KEY,
    "",
    (v) => v,
    (raw) => raw,
  );

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, CLOCK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  if (!now || !policy.loaded || !isLateNight(now)) return null;
  const night = nightKey(now);
  if (dismissed === night) return null;
  const copy = lateNightCopy(policy.mode);

  return (
    <section className="ui-card-shell flex items-start gap-3 px-4 py-3" aria-label="It's late">
      <Moon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-text-primary">{copy.headline}</p>
        <p className="text-xs text-text-secondary">{copy.detail}</p>
        {copy.action && (
          <button
            type="button"
            className="ui-btn-primary ui-btn-sm mt-2 gap-1.5"
            disabled={policy.saving}
            onClick={() => void policy.updateMode("on")}
          >
            {policy.saving && <Loader2 className="ui-spinner-xs" />}
            {copy.action}
          </button>
        )}
      </div>
      <button
        type="button"
        className="ui-btn-icon"
        onClick={() => setDismissed(night)}
        title="Not tonight"
        aria-label="Not tonight"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
