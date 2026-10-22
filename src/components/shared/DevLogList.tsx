import type { DevLogEntry } from "@/db/schema/user-projects";
import { APP_LOCALE } from "@/lib/constants";
import { plainWords } from "@/lib/project-display";

/**
 * What changed, as rows (design reset rule 3): what was done, what comes next
 * under it, the date on the right. It was a bordered card per entry with a
 * "healthy" chip, a "done" prefix and a "green · 2 open TODOs" line — an
 * agent's handoff fields read out to a person.
 */
export function DevLogList({ entries }: { entries: DevLogEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <ul className="ui-devlog">
      {entries.map((entry, i) => {
        const d = new Date(entry.date);
        const dateStr = d.toLocaleDateString(APP_LOCALE, { month: "short", day: "numeric" });
        return (
          <li key={i} className="ui-devlog-row">
            <div className="min-w-0 flex-1">
              {entry.done && <p className="ui-devlog-done">{plainWords(entry.done)}</p>}
              {entry.next && <p className="ui-devlog-next">Next: {plainWords(entry.next)}</p>}
            </div>
            <span className="ui-listrow-trail">{dateStr}</span>
          </li>
        );
      })}
    </ul>
  );
}
