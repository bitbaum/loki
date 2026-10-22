import { cn } from "@/lib/utils";

/**
 * A goal's progress as a ring — the leading slot of its row. The number is the
 * row's trailing fact; the ring is how far along it is at a glance, and a
 * finished goal's ring is the one coloured thing in the list.
 */
export function GoalRing({ value, done = false }: { value: number; done?: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 36 36" className="ui-goal-ring" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="ui-goal-ring-track" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        className={cn("ui-goal-ring-fill", done && "ui-goal-ring-done")}
      />
    </svg>
  );
}
