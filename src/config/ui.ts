/**
 * RAM and disk bars. A disk two-thirds full with 43 GiB free is normal, and
 * drawing it in the warning hue from 66% made the warning colour the loudest
 * thing on /system when nothing was wrong (2026-11-12).
 */
export const HEALTH_THRESHOLDS = {
  warningPct: 85,
  criticalPct: 95,
} as const;

export const GOAL_PROGRESS_THRESHOLDS = {
  cautionPct: 50,
  healthyPct: 80,
} as const;

/** Maps session health short labels to their Tailwind tag classes. */
export const HEALTH_TAG_STYLE: Record<string, string> = {
  good: "ui-tag ui-tag-positive",
  excellent: "ui-tag ui-tag-positive",
  "needs attention": "ui-tag ui-tag-warning",
  degraded: "ui-tag ui-tag-warning",
  critical: "ui-tag ui-tag-negative",
};
