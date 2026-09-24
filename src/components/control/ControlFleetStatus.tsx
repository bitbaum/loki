"use client";

import Link from "next/link";
import { activityHref } from "@/components/activity/activity-shared";
import { ArrowRight, Plus, Radio, Settings2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/dates";
import type { ControlDashboardState, FleetPulse } from "./control-presenter";
import { RUNNER_STATE_DEFINITIONS, deriveRunnerStateKey } from "@/lib/control-states";
import { builderCompactLabel, builderPresenceDetail } from "@/lib/builder-presence";
import type { BuilderChannelPresence } from "@/lib/builder-presence";
import { EXECUTOR_COPY } from "@/config/executor-copy";

/**
 * What the working / awaiting-input / idle chips actually count.
 *
 * Loki sees an agent when it dispatched the run itself, or when the
 * runner tracks a workspace whose name matches a registered project. An agent
 * started outside Loki — a terminal you opened, a background job — is
 * invisible to these numbers. So "0 working" means "nothing Loki is
 * driving", NOT "nothing is happening on this machine", and a bare 0 sitting
 * next to "21 idle" reads as a fleet-wide claim it is not entitled to make.
 * The Workspaces panel says the same thing, but it is most of a page further
 * down — the caveat belongs on the number that provokes the question.
 */
const COUNT_SCOPE_TITLE =
  "Counts agents Loki dispatched, plus workspaces it tracks by project name. " +
  "Agents you started yourself elsewhere are not counted here.";

/**
 * The same caveat, short enough to render.
 *
 * COUNT_SCOPE_TITLE was delivered as a `title` attribute — a tooltip, which
 * does not exist on a touch screen. So on the device where this number is
 * least checkable, the sentence that makes it honest could not be read at all.
 *
 * The number really does mislead: on 2026-09-13 this line read "0 working"
 * while three agent sessions were busy in worktrees on the operator's own
 * machine. They are invisible by construction — they write no dispatch
 * sentinel and open no named tab — so the count is not wrong, it is narrow.
 * A narrow number that presents as a total is the thing to fix, and until the
 * runner can read the live-session registry, saying so is the fix available.
 */
const COUNT_SCOPE_SHORT = "Loki-dispatched only";

type Props = {
  dashboard: ControlDashboardState | null;
  failedCount: number;
  runnerNeverSeen: boolean;
  runnerOffline: boolean;
  runnerStateUnknown: boolean;
  runnerLastPushedAt: string | null;
  runnerVersion?: string | null;
  builderVersions?: { cloud: string | null; local: string | null } | null;
  builderPresence?: BuilderChannelPresence | null;
  runnerExecutionStall: { stalled: boolean; stalledCount: number; oldestSeconds: number } | null;
  lastUpdated: number | null;
  /** Truthful hero headline — deriveFleetPulse(), computed by ControlPanel. */
  fleetPulse: FleetPulse;
  /** The projects actually waiting on a human, most urgent first. The old card
   *  had only a COUNT, so "2 need you" could not say which two or take you to
   *  either — the number was a fact you then had to go hunting for. */
  attentionProjects: { tab: string; name: string }[];
  onFocusProject?: (tab: string) => void;
  /** Opens the fleet settings sheet — autopilot, refresh, builder detail. */
  onOpenSettings: () => void;
  /** Opens the new-project flow. */
  onNewProject?: () => void;
  /** Makes the working/awaiting-input counter chips actionable: selects the
   *  first project in that bucket and scrolls the workspace into view. A
   *  count you can't follow to its subject is noise, not status. */
  onFocusCategory?: (category: "working" | "waiting") => void;
};

/**
 * The first card on Control, and the only one that gets to interrupt.
 *
 * Its brief is one question — *is anything waiting on me?* — an answer, and at
 * most one button. See the note above the render for what it used to carry and
 * why ranking it beat adding to it.
 */
export function ControlFleetStatus({
  dashboard,
  failedCount,
  runnerNeverSeen,
  runnerOffline,
  runnerStateUnknown,
  runnerLastPushedAt,
  runnerVersion,
  builderVersions,
  builderPresence,
  runnerExecutionStall,
  lastUpdated,
  fleetPulse,
  attentionProjects,
  onFocusProject,
  onOpenSettings,
  onNewProject,
  onFocusCategory,
}: Props) {
  // Vocabulary AND arithmetic reconciled with ProjectOperationsView's rail.
  // The triad is "X working · Y awaiting input · Z idle" — three
  // mutually-exclusive buckets, every project in exactly one, all sourced from
  // buildControlPageState's counterCategory tally (the same SSOT the rail
  // reads). The third chip used to be openTabCount ("Z tabs open"), a SUPERSET
  // that re-counted the working/awaiting projects whose tabs were also open —
  // so "1 working · … · 1 tabs open" described the SAME project twice and
  // disagreed with the rail's "0 idle". Now header and rail show identical
  // numbers.
  const ready = dashboard?.waitingCount ?? 0; // agent done, awaiting next step
  const working = dashboard?.runningCount ?? 0;
  const idle = dashboard?.idleCount ?? 0; // inert: not_running / tab_open / closing / completed
  // Before the runner's first push every project reads `offline`, so the triad
  // is 0/0/0 — which is also exactly the "All clear" condition. Say "checking"
  // instead of announcing a calm fleet we know nothing about.
  const countsKnown = dashboard?.countsKnown ?? false;

  // SSOT: label/description/problem-CTA all come from RUNNER_STATE_DEFINITIONS
  // (lib/control-states.ts). Hand-rolled label trees that drifted between this
  // component and RunnerStatusBanner are gone — both read the same source.
  const runnerStateKey = deriveRunnerStateKey({
    neverSeen: runnerNeverSeen,
    offline: runnerOffline,
    stateUnknown: runnerStateUnknown,
  });
  const runnerDef = RUNNER_STATE_DEFINITIONS[runnerStateKey];

  const syncDetail =
    !runnerNeverSeen && runnerLastPushedAt
      ? `sync ${timeAgo(new Date(runnerLastPushedAt).getTime())}`
      : lastUpdated
        ? `page ${timeAgo(lastUpdated)}`
        : null;
  // Append the connected builders' reported versions so the user can confirm
  // which builds are live (helps diagnose stale-runner bugs). Per channel:
  // two builders can be online at once, and collapsing them to one string
  // rendered whichever pushed last — the hero flipped between "builder
  // vbox-0.8.9" and the semver-shaped lie "vdev". A genuine dev build is
  // labeled honestly instead of dressed up as a version number.
  const fmtVersion = (v: string) => (v === "dev" ? "dev build" : `v${v.replace(/^box-/, "")}`);
  const versionDetail =
    runnerStateKey === "connected"
      ? [
          builderVersions?.cloud ? `cloud ${fmtVersion(builderVersions.cloud)}` : null,
          builderVersions?.local ? `app ${fmtVersion(builderVersions.local)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") ||
        (runnerVersion
          ? `${EXECUTOR_COPY.builder.versionPrefix} ${fmtVersion(runnerVersion)}`
          : null)
      : null;
  const compactLabel = builderCompactLabel(runnerStateKey, runnerVersion, builderPresence);
  const presenceDetail =
    builderPresence && runnerStateKey === "connected"
      ? builderPresenceDetail(builderPresence)
      : null;
  // Split, because these two are not the same kind of fact. Sync age and
  // presence are STATUS — they answer "is what I'm reading true right now?",
  // which is the first question anyone has about a dashboard. Build versions
  // are DIAGNOSTICS: load-bearing when a stale runner is suspected (see the
  // note above), irrelevant every other time, and on a phone they were the
  // first thing the page said — "· cloud v0.8.12 · app v0.8.12" ahead of a
  // single word about the fleet. They keep their place on wider screens and
  // stay in the tooltip everywhere, so nothing is lost, only ranked.
  const runnerDetail = [syncDetail, presenceDetail].filter(Boolean).join(" · ") || null;
  const runnerTitle = [runnerDef.description, versionDetail].filter(Boolean).join(" — ");

  const RunnerIcon =
    runnerStateKey === "setup_needed" || runnerStateKey === "offline" ? WifiOff : Radio;
  // A connected runner with a genuine execution stall must not read plain
  // green: "online · sync just now" is the push channel, and it being healthy
  // is exactly how a hung command loop masquerades as fine. The pulse below
  // carries the full stall story; this line just stops contradicting it.
  const executionStalled = Boolean(runnerExecutionStall?.stalled);
  const runnerTone =
    runnerStateKey === "connected" && !executionStalled
      ? "ui-control-fleet-runner-ok"
      : "ui-control-fleet-runner-warn";

  // Compact status word for this header card. The full headline + the
  // "commands queue until it reconnects" explanation + the remediation CTA
  // all live in RunnerStatusBanner (the single prominent alert). Here we only
  // need a glanceable indicator — dot + word + sync timestamp — so the offline
  // story isn't told three times across the page. runnerDef.description still
  // rides along as the hover tooltip for the curious.
  const isStale = runnerOffline || runnerStateUnknown;
  const staleClass = isStale ? "opacity-60" : "";
  const staleTitle =
    isStale && runnerLastPushedAt
      ? `From last sync (${timeAgo(new Date(runnerLastPushedAt).getTime())}) — may be out of date`
      : isStale
        ? EXECUTOR_COPY.builder.staleSync
        : undefined;

  // ── What this card is allowed to say ──────────────────────────────────────
  //
  // It used to say five things at once: runner line with build versions, a
  // refresh and a new-project button, "Fleet autopilot" with its live pulse,
  // the Pause-fleet control, a four-chip counter row, and a two-sentence
  // paragraph explaining what autopilot does. Every one of them was true and
  // the card still failed, because a card that answers five questions answers
  // none of them first — and the largest, highest-contrast control on it was
  // Pause fleet, an action a builder takes roughly never.
  //
  // Now it answers ONE question — *is anything waiting on me?* — and offers
  // the single action that follows from the answer. Everything else is either
  // demoted to the quiet foot line or moved behind the gear. Nothing is
  // deleted; it is ranked, which is the thing that was never done.
  //
  // The states below are ordered by what should interrupt you, most first.
  // The honesty rules survive intact: an unknown fleet says so rather than
  // reporting calm, and a stale one dims and explains itself.
  // Count only what this card can NAME and ACT ON.
  //
  // The first version headlined `attentionCount + failedCount` while the names
  // and the button came from attentionProjects alone — so a fleet with two
  // failed dispatches and no blocked projects announced "2 projects need you",
  // named none of them, and offered no button. That is the exact failure this
  // card was rewritten to remove: a number you then go hunting for. Failed
  // dispatches are a real and different thing, so they get their own headline
  // and their own destination rather than being folded into a count of
  // projects they are not.
  const needsYou = attentionProjects.length;
  const attentionNames = attentionProjects.slice(0, 3).map((p) => p.name);
  const headline = !countsKnown
    ? { dot: "ui-dot-neutral", text: "Checking projects…", sub: null as string | null }
    : needsYou > 0
      ? {
          dot: "ui-dot-warning",
          // Say WHICH KIND of need. This counted only agent attention
          // (session or last-run health) but claimed the whole phrase, so it
          // read as a contradiction of /today's verdict, which counts raised
          // flags as well: Control said "1 project needs you - loki" while
          // the front door named evig. /today is now the complete answer
          // (#863); this page is the fleet, and naming its scope is what
          // stops the same three words meaning two things.
          text: `${needsYou} ${needsYou === 1 ? "project's agent needs" : "projects' agents need"} you`,
          sub: attentionNames.join(" · ") + (needsYou > 3 ? ` +${needsYou - 3}` : ""),
        }
      : failedCount > 0
        ? {
            dot: "ui-dot-negative",
            text: `${failedCount} dispatch${failedCount === 1 ? "" : "es"} failed`,
            sub: "Retry or dismiss them below.",
          }
        : fleetPulse.key === "failing" || fleetPulse.key === "stalled"
          ? { dot: "ui-dot-negative", text: fleetPulse.label, sub: fleetPulse.detail }
          : // Half-finished is not a failure and not health. It gets the warning
            // dot rather than the neutral one, because a grey dot next to "5 of
            // last 5 partial" is the same silence this whole change removes.
            //
            // `inbox` shares that dot for the same reason: the headline reads
            // "Waiting on you", and a neutral grey beside those words is the
            // page agreeing with itself in tone while disagreeing in substance.
            // `unknown` deliberately does NOT — we could not read the queue, so
            // neutral is the honest colour for "no idea".
            fleetPulse.key === "partial" || fleetPulse.key === "inbox"
            ? { dot: "ui-dot-warning", text: fleetPulse.label, sub: fleetPulse.detail }
            : working > 0
              ? {
                  dot: "ui-dot-positive animate-pulse",
                  // The detail WINS when there is one. This line used to be
                  // `${working} agents working` unconditionally, which quietly
                  // discarded the pulse's own sentence — so a partial streak
                  // detected while an agent worked could never be shown. The
                  // count is already visible elsewhere on this card; a warning
                  // nobody can see is worse than no warning.
                  text: fleetPulse.label,
                  sub: fleetPulse.detail ?? `${working} agent${working === 1 ? "" : "s"} working`,
                }
              : { dot: "ui-dot-neutral", text: fleetPulse.label, sub: fleetPulse.detail };

  // At most one. A card with two equally-weighted buttons has no primary, and
  // this card's whole job is to make the next step obvious.
  const topAttention = attentionProjects[0] ?? null;

  return (
    <section className="ui-control-hero">
      <div className="ui-hero-row">
        <div className="ui-hero-answer">
          {/* Deliberately NOT dimmed by staleClass.
              Dimming says "this number may be out of date", which is the right
              thing to say about the counters and the wrong thing to do to the
              headline: it rendered "Stalled" — the single most urgent state
              this card has — as the quietest text on it. Staleness is a caveat
              about the answer, so it goes next to the answer in words (the
              "from last sync" line below) rather than making the answer harder
              to read. */}
          <p className="ui-hero-headline">
            <span className={cn("ui-dot ui-hero-dot", headline.dot)} aria-hidden="true" />
            <span>{headline.text}</span>
          </p>
          {headline.sub && <p className="ui-hero-sub">{headline.sub}</p>}
          {isStale && (
            <p className="ui-hero-stale" title={staleTitle}>
              {runnerLastPushedAt
                ? `From last sync ${timeAgo(new Date(runnerLastPushedAt).getTime())} — may be out of date`
                : EXECUTOR_COPY.builder.staleSync}
            </p>
          )}
        </div>
        <div className="ui-hero-tools">
          {onNewProject && (
            <button
              type="button"
              onClick={onNewProject}
              className="ui-btn-icon"
              title="New project"
              aria-label="New project"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className="ui-btn-icon"
            title="Fleet settings — autopilot, refresh, builder status"
            aria-label="Fleet settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {needsYou > 0 && topAttention && onFocusProject ? (
        <button
          type="button"
          onClick={() => onFocusProject(topAttention.tab)}
          className="ui-hero-action ui-btn-primary"
        >
          Open {topAttention.name}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : failedCount > 0 ? (
        <button
          type="button"
          onClick={() =>
            document
              .getElementById("control-attention")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="ui-hero-action ui-btn-primary"
        >
          Review failed dispatches
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : fleetPulse.key === "failing" ? (
        // Was a hand-written "/activity?window=week" — the one activity link
        // in the app that skipped activityHref, and so the one that carried no
        // filter. "Review failures" landed the operator on an unfiltered week
        // of every dispatch, success and failure alike, and left them to find
        // the four the sentence above had just counted. `attention` is exactly
        // that set: error, timeout, hang, partial, unconfirmed.
        <Link
          href={activityHref({ window: "week", filter: "attention" })}
          className="ui-hero-action ui-btn-primary"
        >
          Review failures
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}

      {/* The foot carries what used to be four tappable chips and a runner
          line. Counts stay clickable where clicking does something; the rest
          is text, because a chip that only reports is a button that lies. */}
      <div className="ui-hero-foot">
        {/* One text node inside, not sibling flex items. Nesting the sync age
            as its own child made it a FLEX ITEM of this span, so at 320px —
            where "Cloud + this computer online" wraps — the age floated into a
            second column beside the wrapped label and read as a broken
            two-column layout. As prose it just wraps. */}
        <span className={cn("ui-hero-runner", runnerTone)} title={runnerTitle}>
          <RunnerIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {compactLabel}
            {executionStalled && " · not executing"}
            {runnerDetail && <span className="ui-hero-sync"> · {runnerDetail}</span>}
          </span>
        </span>
        {countsKnown && (
          <span
            className={cn("ui-hero-counts", staleClass)}
            title={staleTitle ?? COUNT_SCOPE_TITLE}
          >
            {working > 0 && onFocusCategory ? (
              <button
                type="button"
                onClick={() => onFocusCategory("working")}
                className="ui-hero-count-link"
              >
                {working} working
              </button>
            ) : (
              <>{working} working</>
            )}
            {" · "}
            {ready > 0 && onFocusCategory ? (
              <button
                type="button"
                onClick={() => onFocusCategory("waiting")}
                className="ui-hero-count-link"
              >
                {ready} awaiting input
              </button>
            ) : (
              <>{ready} awaiting input</>
            )}
            {" · "}
            {idle} idle
          </span>
        )}
        {countsKnown && (
          <span className="ui-hero-count-scope" title={COUNT_SCOPE_TITLE}>
            {COUNT_SCOPE_SHORT}
          </span>
        )}
        {versionDetail && <span className="ui-hero-sync hidden sm:inline">{versionDetail}</span>}
      </div>
    </section>
  );
}
