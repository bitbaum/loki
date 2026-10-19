import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DIGEST_WINDOWS, type DigestWindow } from "@/db/queries/digests";
import type { ActivityFilter } from "@/lib/activity-events";
import { WINDOW_LABEL, activityHref, formatActivityTime } from "./activity-shared";

// The time window, and what it means in real dates. Range is inlined ("since
// 8. Juni, 22:38") so the user doesn't have to count days backward to know what
// the picker means. Outcome filtering lives on the feed itself, next to the
// counts that provoke it.
export function FilterCard({
  digestWindow,
  projectKey,
  filter,
  since,
}: {
  digestWindow: DigestWindow;
  projectKey: string | null;
  filter: ActivityFilter;
  since: string;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="ui-kicker">Last</span>
          <span className="text-xs text-text-tertiary">since {formatActivityTime(since)}</span>
        </div>
        {/* Equal cells: as chips with "Last" beside them the row overflowed
            by a few pixels on a phone and "Last" went alone on a line. */}
        <nav className="ui-segmented" aria-label="Time window">
          {DIGEST_WINDOWS.map((w) => (
            <Link
              key={w}
              href={activityHref({ window: w, project: projectKey, filter })}
              aria-current={digestWindow === w ? "page" : undefined}
              className={digestWindow === w ? "ui-segment-active" : "ui-segment"}
            >
              {WINDOW_LABEL[w]}
            </Link>
          ))}
        </nav>
      </div>
    </Card>
  );
}
