import type { Momentum } from "@/lib/suggestions/board";

/**
 * Three numbers, all of them records of what the person did: suggestions
 * chosen this week, the run of days with at least one, and the total. Nothing
 * here is estimated or projected — the page keeps score, it does not cheer.
 */
export function MomentumStrip({ momentum }: { momentum: Momentum }) {
  const cells: { n: number; label: string }[] = [
    { n: momentum.takenThisWeek, label: "chosen this week" },
    { n: momentum.dayStreak, label: momentum.dayStreak === 1 ? "day in a row" : "days in a row" },
    { n: momentum.takenAllTime, label: "chosen in total" },
  ];
  return (
    <dl className="ui-sugg-momentum" aria-label="Momentum">
      {cells.map((c) => (
        <div key={c.label} className="ui-sugg-momentum-cell">
          <dd className="ui-sugg-momentum-n">{c.n}</dd>
          <dt className="ui-sugg-momentum-k">{c.label}</dt>
        </div>
      ))}
    </dl>
  );
}
