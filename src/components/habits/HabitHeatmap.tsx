"use client";

import { type HabitFrequency, isHabitScheduled } from "@/lib/constants/statuses";
import { HABIT_HISTORY_DAYS } from "@/lib/constants";
import { toLocalDateStr } from "@/lib/dates";

// Mon-first row order: row 0=Mon(1)…row 5=Sat(6), row 6=Sun(0)
const ROW_TO_DOW = [1, 2, 3, 4, 5, 6, 0] as const;
const ROW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function lastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(toLocalDateStr(d));
  }
  return dates;
}

/** Convert JS getDay() (0=Sun) to Mon-first row index (0=Mon…6=Sun) */
function dowToRow(dow: number): number {
  return dow === 0 ? 6 : dow - 1;
}

export function HabitHeatmap({
  completedDates,
  frequency,
}: {
  completedDates: string[];
  frequency: HabitFrequency;
}) {
  const done = new Set(completedDates);
  const dates = lastNDates(HABIT_HISTORY_DAYS);
  const today = dates[dates.length - 1];

  // Row of the first date in the Mon-first grid
  const firstDateRow = dowToRow(new Date(dates[0] + "T12:00:00").getDay());
  const numCols = Math.ceil((firstDateRow + HABIT_HISTORY_DAYS) / 7);

  // Larger cells and a legend: at 14px, with "not due" and "missed" one shade
  // apart on the card's own ground, the grid read as a broken grey block
  // (2026-10-01) rather than a month you could read at a glance.
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-1 shrink-0">
          {ROW_LABELS.map((label, i) => (
            <div
              key={i}
              className="h-5 w-3 flex items-center justify-end text-nano text-text-muted leading-none"
            >
              {i % 2 === 0 ? label : ""}
            </div>
          ))}
        </div>

        {/* Week columns, oldest left → newest right */}
        <div className="flex gap-1">
          {Array.from({ length: numCols }, (_, col) => (
            <div key={col} className="flex flex-col gap-1">
              {ROW_LABELS.map((_, row) => {
                const dateIdx = col * 7 + row - firstDateRow;
                if (dateIdx < 0 || dateIdx >= HABIT_HISTORY_DAYS) {
                  return <div key={row} className="h-5 w-5 rounded" />;
                }
                const date = dates[dateIdx];
                const due = isHabitScheduled(frequency, ROW_TO_DOW[row]);
                const completed = done.has(date);
                const isToday = date === today;

                let title = date;
                if (!due) title += " (not due)";
                else if (completed) title += " ✓";

                return (
                  <div
                    key={row}
                    title={title}
                    className={[
                      "ui-habit-cell",
                      isToday ? "ui-habit-cell-today" : "",
                      !due
                        ? "ui-habit-cell-off"
                        : completed
                          ? "ui-habit-cell-done"
                          : "ui-habit-cell-missed",
                    ].join(" ")}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="ui-habit-legend">
        <span className="ui-habit-cell ui-habit-cell-done" aria-hidden /> done
        <span className="ui-habit-cell ui-habit-cell-missed" aria-hidden /> missed
        <span className="ui-habit-cell ui-habit-cell-off" aria-hidden /> not scheduled
      </div>
    </div>
  );
}
