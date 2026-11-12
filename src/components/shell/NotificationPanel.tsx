"use client";

import { useId, useState } from "react";
import { BellOff, X } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import type { Alert } from "@/db/schema/alerts";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { splitDescription } from "@/components/alerts/AlertList";
import { groupBell, splitBell, type BellGroup } from "@/lib/alerts/relevance";
import { bellWords } from "@/lib/notify/intrusion-words";
import { patchJson } from "@/lib/api/fetch";
import { timeAgo } from "@/lib/dates";
import { ALERT_SEVERITY } from "@/lib/constants/statuses";

/** An alert as the bell receives it (app/api/alerts). */
type BellRow = Alert & { earlier?: boolean };

/** Where a row with no link of its own opens: the list every operator alert is on. */
const FALLBACK_HREF = "/today";

/** The row as the person reads it: plain title, one line, folded with its repeats. */
function words(a: BellRow) {
  const { title, description } = bellWords(a);
  return { title, summary: splitDescription(description).summary };
}

/** One line in the bell, the count of what is on /system: never counted, never a dead end. */
function systemLine(n: number): string {
  return n === 1
    ? "1 thing the server noticed needs nothing from you"
    : `${n} things the server noticed need nothing from you`;
}

/**
 * The bell's sheet: what still needs you, as rows, then "Earlier".
 *
 * It was a stack of cards — title, two lines of description, "8d ago ·
 * Details · Dismiss" and a bordered button per alert — under a red "9+" that
 * counted nudges 8, 19 and 28 days old (owner, 2026-10-21). Now each alert is
 * one ListRow: a dot only for a real problem, the title, one grey line, when.
 * The whole row opens it; the × dismisses it. Anything past its relevance
 * (lib/alerts/relevance) sits under "Earlier", which the bell does not count,
 * and one tap clears the lot.
 */
export function NotificationPanel({ onClose, titleId }: { onClose: () => void; titleId?: string }) {
  const { data, loading, error, refetch } = useFetch<{ alerts: BellRow[] }>("/api/alerts");
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [clearing, setClearing] = useState(false);
  const ownId = useId();
  const headingId = titleId ?? ownId;
  const { current, earlier, onSystem } = splitBell(
    (data?.alerts ?? []).filter((a) => !gone.has(a.id)),
  );
  const currentGroups = groupBell(current, words);
  const earlierGroups = groupBell(earlier, words);

  const dismiss = async (ids: string[]) => {
    setGone((g) => {
      const next = new Set(g);
      for (const id of ids) next.add(id);
      return next;
    });
    const results = await Promise.all(
      ids.map((id) => patchJson(`/api/alerts/${id}/dismiss`, {}).catch(() => null)),
    );
    // A dismissal that did not land comes back, rather than vanishing here
    // and reappearing on the next page load.
    if (results.some((r) => !r?.ok)) {
      setGone(new Set());
      refetch();
    }
  };

  return (
    <div className="ui-notification-sheet">
      <header className="ui-notification-header">
        <h2 id={headingId} className="ui-notification-title">
          Notifications
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="ui-topbar-btn"
          aria-label="Close notifications"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {/* Following a row closes the sheet: the link has navigated by the time
          the click bubbles here. The × is a button, not a link, so it stays. */}
      <div
        className="ui-notification-body"
        onClick={(e) => {
          if (isLink(e.target)) onClose();
        }}
      >
        {loading && !data && <p className="ui-notification-quiet">Loading…</p>}

        {error && !data && (
          <div className="ui-notification-quiet">
            Notifications did not load.{" "}
            <button type="button" className="ui-section-link" onClick={() => refetch()}>
              Try again
            </button>
          </div>
        )}

        {data && current.length === 0 && earlier.length === 0 && onSystem === 0 && (
          <EmptyState icon={BellOff} title="You're all caught up" size="sm" />
        )}

        {data && current.length === 0 && (earlier.length > 0 || onSystem > 0) && (
          <p className="ui-notification-quiet">Nothing new needs you.</p>
        )}

        {current.length > 0 && (
          <List aria-label="Needs you">
            {currentGroups.map((g) => (
              <AlertRow key={g.key} group={g} onDismiss={dismiss} />
            ))}
          </List>
        )}

        {earlier.length > 0 && (
          <section aria-label="Earlier" className="ui-notification-earlier">
            <SectionHeading
              title="Earlier"
              right={
                <button
                  type="button"
                  className="ui-section-link"
                  disabled={clearing}
                  onClick={async () => {
                    setClearing(true);
                    await dismiss(earlier.map((a) => a.id));
                    setClearing(false);
                  }}
                >
                  {clearing ? "Clearing…" : "Clear all"}
                </button>
              }
            />
            <List aria-label="Earlier notifications">
              {earlierGroups.map((g) => (
                <AlertRow key={g.key} group={g} onDismiss={dismiss} quiet />
              ))}
            </List>
          </section>
        )}

        {onSystem > 0 && (
          <List aria-label="On the System page">
            <ListRow href="/system#system-alerts" title={systemLine(onSystem)} trailing="System" />
          </List>
        )}
      </div>
    </div>
  );
}

function AlertRow({
  group,
  onDismiss,
  quiet = false,
}: {
  group: BellGroup<BellRow>;
  onDismiss: (ids: string[]) => void;
  /** Under "Earlier": a record, so no coloured dot. */
  quiet?: boolean;
}) {
  const newest = group.rows[0]!;
  const times = group.rows.length;
  const summary =
    times > 1 ? `${times} times · ${group.summary}`.replace(/ · $/, "") : group.summary;
  const status =
    newest.severity === ALERT_SEVERITY.URGENT
      ? ("negative" as const)
      : newest.severity === ALERT_SEVERITY.WARNING
        ? ("warning" as const)
        : undefined;
  return (
    <ListRow
      // Every row opens somewhere: a notice with no button of its own opens
      // the list it is recorded on, rather than being a row nothing answers.
      href={newest.actionUrl ?? FALLBACK_HREF}
      title={group.title}
      secondary={summary || undefined}
      status={summary && !quiet ? status : undefined}
      trailing={timeAgo(new Date(newest.createdAt).getTime())}
      menu={
        <button
          type="button"
          className="ui-btn-icon"
          aria-label={`Dismiss: ${group.title}`}
          title="Dismiss"
          onClick={() => onDismiss(group.rows.map((r) => r.id))}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      }
    />
  );
}

function isLink(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a") !== null;
}
