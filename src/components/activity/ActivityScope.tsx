"use client";

import { useRouter } from "next/navigation";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import type { DigestWindow } from "@/db/queries/digests";
import type { ActivityFilter } from "@/lib/activity-events";
import { WINDOW_CHOICE_LABEL, activityHref } from "./activity-shared";

const ALL = "__all__";

/**
 * What the page covers — when, and which project — as two menus on one line
 * (design reset rule 7). They were a strip of project chips cut off at the
 * right edge and a time picker in a card of its own.
 */
export function ActivityScope({
  window,
  project,
  filter,
  projects,
}: {
  window: DigestWindow;
  project: string | null;
  filter: ActivityFilter;
  projects: { key: string; title: string }[];
}) {
  const router = useRouter();
  const go = (next: { window?: DigestWindow; project?: string | null }) =>
    router.push(
      activityHref({
        window: next.window ?? window,
        project: next.project === undefined ? project : next.project,
        filter,
      }),
    );
  return (
    <div className="flex flex-wrap items-center gap-x-6">
      <ChoiceMenu
        label="When"
        value={window}
        align="start"
        options={(Object.keys(WINDOW_CHOICE_LABEL) as DigestWindow[]).map((w) => ({
          value: w,
          label: WINDOW_CHOICE_LABEL[w],
        }))}
        onChange={(w) => go({ window: w })}
      />
      {projects.length > 1 && (
        <ChoiceMenu
          label="Project"
          value={project ?? ALL}
          align="start"
          options={[
            { value: ALL, label: "All projects" },
            ...projects
              .slice()
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((p) => ({ value: p.key, label: p.title })),
          ]}
          onChange={(key) => go({ project: key === ALL ? null : key })}
        />
      )}
    </div>
  );
}

/** "Show: Needs you (2) ▾" — the feed's outcome filter, at its heading. The
 *  counts were a second row of chips that scrolled off the right edge. */
export function ActivityShowMenu({
  window,
  project,
  filter,
  options,
}: {
  window: DigestWindow;
  project: string | null;
  filter: ActivityFilter;
  options: { value: ActivityFilter; label: string }[];
}) {
  const router = useRouter();
  return (
    <ChoiceMenu
      label="Show"
      value={filter}
      options={options}
      onChange={(f) => router.push(activityHref({ window, project, filter: f }))}
    />
  );
}
