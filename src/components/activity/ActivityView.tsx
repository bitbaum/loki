import Link from "next/link";
import { Activity } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { getActivitySnapshot, getProjectDigest, type DigestWindow } from "@/db/queries/digests";
import { getProjects } from "@/db/queries/projects";
import { eventNeedsAttention, normalizeActivityFilter } from "@/lib/activity-events";
import { activityHeadline, computeMomentum, summarizeActivity } from "@/lib/activity-summary";
import { projectTitle } from "@/lib/project-display";
import { ActivityScope } from "./ActivityScope";
import { ActivityReport } from "./ActivityReport";
import { NeedsYouCard } from "./NeedsYouCard";
import { EventStream } from "./EventStream";
import { RANGE_LABEL, activityHref, type ProjectNames } from "./activity-shared";

/**
 * /activity — what the fleet did, as a sentence and a list. Rebuilt to the
 * design reset (docs/development/design-reset-2026-10.md) from the owner's
 * phone, where the page opened with a bordered hero, a bar chart, four
 * coloured tiles, a red card of failures, a strip of project chips, a time
 * picker in its own card, a second row of count chips and a report card —
 * eight boxes before the first thing that happened.
 *
 * Now: one line of scope (time and project, each a menu), the answer as a
 * sentence, what needs you as rows, then what happened as rows under day
 * headings. The page's one action is the written report.
 */
export async function ActivityView({
  userId,
  window,
  project,
  status,
}: {
  userId: string;
  window?: string;
  project?: string;
  status?: string;
}) {
  const [digest, snapshot, projects] = await Promise.all([
    getProjectDigest(userId, { window, projectKey: project }),
    getActivitySnapshot(userId),
    getProjects(userId).catch(() => []),
  ]);
  const filter = normalizeActivityFilter(status);
  const hasActivity = digest.events.length > 0;
  // Every project is named the way a person names it (projectTitle), and
  // its row opens that project's Watch page.
  const names: ProjectNames = {};
  for (const p of projects) names[p.name] = { title: projectTitle(p), id: p.id };
  const titleOf = (key: string) => names[key]?.title ?? key;

  const summary = summarizeActivity(digest.events);
  const momentum = computeMomentum(digest.events.length, digest.previousCount);
  const attentionEvents = digest.events.filter(eventNeedsAttention);
  const context = [
    summary.agentLabel ? `${summary.agentLabel} of agent time` : null,
    momentum.label,
  ].filter(Boolean);

  // Nothing in this window: say when there last was, and offer the window
  // that has it.
  const suggestion = hasActivity ? null : lookback(snapshot.latestPromptAt, digest.until);

  return (
    <PageLayout
      title="Activity"
      maxWidth="max-w-2xl"
      action={<ActivityReport window={digest.window} project={digest.projectKey} />}
    >
      <div className="flex flex-col gap-3">
        <ActivityScope
          window={digest.window}
          project={digest.projectKey}
          filter={filter}
          projects={digest.projects.map((p) => ({ key: p.key, title: titleOf(p.key) }))}
        />
        {hasActivity && (
          <div>
            <p className="ui-activity-lede">{activityHeadline(summary)}</p>
            {context.length > 0 && <p className="ui-activity-lede-sub">{context.join(" · ")}</p>}
          </div>
        )}
      </div>

      {hasActivity ? (
        <>
          <NeedsYouCard
            events={attentionEvents}
            digestWindow={digest.window}
            projectKey={digest.projectKey}
            names={names}
          />
          <EventStream
            events={digest.events}
            filter={filter}
            digestWindow={digest.window}
            projectKey={digest.projectKey}
            names={names}
          />
        </>
      ) : (
        <EmptyState
          icon={Activity}
          title={
            digest.projectKey
              ? `Nothing in ${titleOf(digest.projectKey)} in ${RANGE_LABEL[digest.window]}`
              : `Nothing happened in ${RANGE_LABEL[digest.window]}`
          }
          action={
            digest.projectKey ? (
              <Link
                href={activityHref({ window: digest.window })}
                className="ui-btn-secondary"
              >
                Show every project
              </Link>
            ) : suggestion && suggestion !== digest.window ? (
              <Link href={activityHref({ window: suggestion })} className="ui-btn-secondary">
                Show {RANGE_LABEL[suggestion]}
              </Link>
            ) : undefined
          }
        />
      )}
    </PageLayout>
  );
}

/** The narrowest window that holds the last thing that happened. */
function lookback(latestAt: string | null, until: string): DigestWindow | null {
  if (!latestAt) return null;
  const hours = (Date.parse(until) - Date.parse(latestAt)) / 3_600_000;
  if (hours < 1) return "hour";
  if (hours < 24) return "day";
  if (hours < 24 * 7) return "week";
  if (hours < 24 * 30) return "month";
  return null;
}
