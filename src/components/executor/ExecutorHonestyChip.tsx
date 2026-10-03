import { cn } from "@/lib/utils";
import type { ExecutorHonestyLabel } from "@/lib/executor-honesty";

const KIND_CLASS: Record<ExecutorHonestyLabel["kind"], string> = {
  queued: "ui-executor-honesty-neutral",
  "needs-builder": "ui-executor-honesty-warning",
  "needs-github": "ui-executor-honesty-warning",
  "needs-gateway": "ui-executor-honesty-warning",
  "builder-starting": "ui-executor-honesty-positive",
};

/** Compact honesty label for dispatch / terminal actions. */
export function ExecutorHonestyChip({
  honesty,
  className,
  compact = false,
}: {
  honesty: ExecutorHonestyLabel | null;
  className?: string;
  /** Phones show only the coloured dot (the words stay for screen readers and
   *  in the title). Beside a composer's send button, "Cloud builder online"
   *  was wide enough to push the composer's own tools onto a second row. */
  compact?: boolean;
}) {
  if (!honesty) return null;
  if (!compact) {
    return (
      <span className={cn(KIND_CLASS[honesty.kind], className)} title={honesty.title}>
        {honesty.label}
      </span>
    );
  }
  return (
    <span
      className={cn(KIND_CLASS[honesty.kind], "ui-executor-honesty-compact", className)}
      title={`${honesty.label} — ${honesty.title}`}
    >
      <span className="ui-executor-honesty-dot" aria-hidden />
      <span className="max-sm:sr-only">{honesty.label}</span>
    </span>
  );
}
