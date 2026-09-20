import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Loader2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityFilter } from "@/lib/activity-events";
import type {
  ActivityMomentum,
  ActivityPulse as Pulse,
  ActivitySummary,
} from "@/lib/activity-summary";
import { activityHeadline } from "@/lib/activity-summary";
import type { DigestWindow } from "@/db/queries/digests";
import { ActivityPulse } from "./ActivityPulse";
import { RANGE_LABEL, activityHref } from "./activity-shared";

/**
 * The answer, before the evidence.
 *
 * The page used to open with a project chip wall, then a window picker, then a
 * list — three rows of controls before a single fact. Someone opening this at
 * 9am wants one sentence ("1 thing needs you") and one picture (when the fleet
 * worked), and only then the means to dig.
 *
 * Every number here is also a destination: a KPI that cannot be followed to its
 * subject is decoration, so each tile links into the feed already filtered.
 */
export function ActivityHero({
  summary,
  momentum,
  pulse,
  digestWindow,
  projectKey,
}: {
  summary: ActivitySummary;
  momentum: ActivityMomentum;
  pulse: Pulse;
  digestWindow: DigestWindow;
  projectKey: string | null;
}) {
  const headline = activityHeadline(summary);
  const tiles: {
    id: ActivityFilter;
    label: string;
    value: number;
    Icon: typeof CheckCircle2;
    tone?: "alert" | "good";
  }[] = [
    {
      id: "attention",
      label: "Needs you",
      value: summary.attention,
      Icon: AlertTriangle,
      tone: "alert",
    },
    { id: "done", label: "Shipped", value: summary.shipped, Icon: CheckCircle2, tone: "good" },
    { id: "running", label: "Running", value: summary.running, Icon: Loader2 },
  ];

  return (
    <section className={cn("ui-activity-hero", summary.attention > 0 && "ui-activity-hero-alert")}>
      <p className="ui-activity-headline">{headline}</p>

      <p className="ui-activity-context">
        {RANGE_LABEL[digestWindow]}
        {projectKey && (
          <>
            {" "}
            · <span className="text-text-secondary">{projectKey}</span>
          </>
        )}
        {summary.agentLabel && (
          <>
            {" "}
            · <Clock className="mb-0.5 inline h-3 w-3" aria-hidden />{" "}
            <span className="text-text-secondary">{summary.agentLabel}</span> of agent time
          </>
        )}
        {momentum.label && (
          <>
            {" "}
            · <TrendingUp className="mb-0.5 inline h-3 w-3" aria-hidden /> {momentum.label}
          </>
        )}
      </p>

      <ActivityPulse pulse={pulse} digestWindow={digestWindow} />

      <div className="ui-activity-kpis">
        {tiles.map(({ id, label, value, Icon, tone }) => (
          <Link
            key={id}
            href={activityHref({ window: digestWindow, project: projectKey, filter: id })}
            className={cn(
              "ui-activity-kpi",
              value > 0 && tone === "alert" && "ui-activity-kpi-alert",
              value > 0 && tone === "good" && "ui-activity-kpi-good",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="ui-activity-kpi-value tabular-nums">{value}</span>
            <span className="ui-activity-kpi-label">{label}</span>
          </Link>
        ))}
        {/* A LINK, like every tile beside it. This was the one number on the
            row you could not open — and on 2026-09-20 it was the biggest, 49
            against "0 Running". Its only explanation was a `title`, which a
            touch device never shows. */}
        {summary.queued > 0 && (
          <Link
            href={activityHref({ window: digestWindow, project: projectKey, filter: "queued" })}
            className="ui-activity-kpi"
            title="Dispatched, but no run has been recorded yet — waiting on a builder to pick it up."
          >
            <span className="ui-activity-kpi-value tabular-nums">{summary.queued}</span>
            <span className="ui-activity-kpi-label">Queued</span>
          </Link>
        )}
      </div>
    </section>
  );
}
