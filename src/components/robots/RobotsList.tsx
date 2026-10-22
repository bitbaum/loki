"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Search } from "lucide-react";
import { NewRobotButton } from "./NewRobotButton";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import type { RobotWithAttributes } from "@/db/queries/robots";
import { getJson, postJson } from "@/lib/api/fetch";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/timings";
import { MARKET_OFFERS, MARKET_OFFER_LABEL, ROBOT_CLASS_LABEL } from "@/config/actors";

/**
 * /robots — the machines you own, as rows. Rebuilt to the design reset
 * (docs/development/design-reset-2026-10.md) as one of its two worked
 * examples: the title is the top bar's, the one primary action ("Add robot")
 * is the round + beside the avatar, the search is the list's first row, each
 * robot is one ListRow, and an empty book is an icon, a line and one button.
 *
 * It renders its own PageLayout because the page action has to reach this
 * list's search state when a robot is added.
 */
export function RobotsList({
  initialRobots,
  initialTotal,
}: {
  initialRobots: RobotWithAttributes[];
  initialTotal: number;
}) {
  const [robots, setRobots] = useState(initialRobots);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [fetchError, setFetchError] = useState(false);
  const skipInitialFetch = useRef(true);

  const search = useCallback(async (q: string, signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ q, limit: "100" });
      const data = await getJson<{ robots: RobotWithAttributes[]; total: number }>(
        `/api/robots?${params}`,
        { signal },
      );
      if (signal?.aborted) return;
      setFetchError(false);
      setRobots(data.robots);
      setTotal(data.total);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setFetchError(true);
    }
  }, []);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => search(query, ctrl.signal), SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, search]);

  const reload = () => search(query);
  // `total` counts what matches the search; the book is empty only when there
  // is no search and nothing in it.
  const bookEmpty = total === 0 && !query;

  return (
    <PageLayout
      title="Robots"
      maxWidth="max-w-2xl"
      action={<NewRobotButton trigger="page-action" onCreated={reload} />}
    >
      {fetchError && (
        <div className="ui-callout-negative items-center justify-between text-status-negative">
          <span>Could not load your robots.</span>
          <button type="button" onClick={reload} className="ui-btn-ghost shrink-0">
            Try again
          </button>
        </div>
      )}

      {bookEmpty && !fetchError ? (
        <EmptyState
          icon={Bot}
          title="A vacuum is a robot. So is a humanoid."
          action={<AddTwoVacuumsButton onCreated={reload} />}
        />
      ) : (
        <div>
          <ListSearch value={query} onChange={setQuery} placeholder="Search robots" />
          {robots.length === 0 && !fetchError ? (
            <EmptyState
              icon={Search}
              title={`No robot matches “${query}”`}
              size="sm"
              action={
                <button type="button" onClick={() => setQuery("")} className="ui-btn-secondary">
                  Show every robot
                </button>
              }
            />
          ) : (
            <List aria-label="Robots">
              {robots.map((robot) => (
                <ListRow
                  key={robot.id}
                  href={`/robots/${robot.id}`}
                  icon={Bot}
                  title={robot.name}
                  secondary={robotLine(robot)}
                  chevron
                />
              ))}
            </List>
          )}
        </div>
      )}
    </PageLayout>
  );
}

/** "Vacuum · iRobot Roomba j7+ · rentable" — what it is, and what it is for. */
function robotLine(robot: RobotWithAttributes): string {
  const kind = robot.robotClass ? ROBOT_CLASS_LABEL[robot.robotClass] : "Robot";
  const spec = [robot.make, robot.model].filter(Boolean).join(" ");
  const offers = MARKET_OFFERS.filter((offer) => robot.market[offer])
    .map((offer) => MARKET_OFFER_LABEL[offer].toLowerCase())
    .join(", ");
  return [kind, spec, offers].filter(Boolean).join(" · ");
}

function AddTwoVacuumsButton({ onCreated }: { onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <button
      type="button"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          const res = await postJson("/api/robots/defaults", {});
          if (res.ok) onCreated();
        } finally {
          setSaving(false);
        }
      }}
      className="ui-btn-secondary"
    >
      {saving ? "Adding…" : "Add my two vacuums"}
    </button>
  );
}
