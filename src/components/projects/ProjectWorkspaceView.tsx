import Link from "next/link";
import { ArrowLeft, Cat, ExternalLink, GitBranch } from "lucide-react";
import type { ProjectDossier } from "@/db/queries/project-dossier";
import { ProjectWorkspaceHeader } from "./ProjectWorkspaceHeader";
import { ProjectTabs } from "./ProjectTabs";
import { ProjectContextEditor } from "./ProjectContextEditor";
import { ProjectPlanSection } from "./ProjectPlanSection";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { ProjectFeedbackSection } from "./ProjectFeedbackSection";
import { DoneSection, NextSection, NowSection } from "./ProjectDossierSections";
import { OrangeCatPublishButton } from "./OrangeCatPublishButton";
import { ProjectPublicListingToggle } from "./ProjectPublicListingToggle";
import { ProjectFeatureToggle } from "./ProjectFeatureToggle";
import { SolonFoundButton } from "./SolonFoundButton";
import { LiveUrlField } from "./LiveUrlField";
import { RegisterSiteButton } from "./RegisterSiteButton";
import { getProjectLinks } from "./project-detail-types";
import { getHealthSignals, HEALTH_SIGNAL_CONFIG } from "./project-badges";
import { computeProjectHealth } from "@/lib/project-health";
import { FixSignalButton } from "./ProjectActionButtons";
import { ProjectKickoff } from "./ProjectKickoff";
import { AssistantContextBridge } from "./AssistantContextBridge";
import { needsKickoff } from "@/lib/project-kickoff";
import { deriveBuildStatus, isBuildActive } from "@/lib/project-build-status";
import { ProjectBuildStatus } from "./ProjectBuildStatus";
import { answer, cleanDescription } from "@/lib/project-display";
import { formatBtc } from "@/lib/format";

export function ProjectWorkspaceView({
  dossier,
  shareAction,
  autoKickoff = false,
  viewerIsSiteOperator = false,
}: {
  dossier: ProjectDossier;
  shareAction?: React.ReactNode;
  /** Arrived from a one-click build (OrangeCat handoff): start the kickoff without a press. */
  autoKickoff?: boolean;
  /** Viewer runs this Loki instance, so they may curate its landing page. */
  viewerIsSiteOperator?: boolean;
}) {
  const { detail, userProject } = dossier;
  const project = detail.project;
  const attrs = detail.attrs;
  const workspaceKey = userProject?.name ?? project.name;
  const links = getProjectLinks(attrs, userProject?.gitUrl ?? project.gitUrl, userProject?.liveUrl);
  const healthSignals = getHealthSignals(attrs);
  const health = computeProjectHealth({
    description: project.description,
    gitUrl: userProject?.gitUrl ?? project.gitUrl,
    dirPath: userProject?.dirPath,
    liveUrl: userProject?.liveUrl,
    attrs,
  });
  // ≥2 consecutive most-recent finished runs timing out is a pattern worth a
  // one-click diagnosis, not something the user should discover by scrolling.
  const finishedRuns = dossier.runs.filter((run) => run.finishedAt);
  let timeoutStreak = 0;
  for (const run of finishedRuns) {
    if (run.outcome !== "timeout") break;
    timeoutStreak += 1;
  }
  const latestDevLogEntry = [...(detail.devLog ?? [])].reverse()[0] ?? null;
  const nextStep = answer(latestDevLogEntry?.next) ?? answer(attrs.next_step);
  const primaryOrangeCatLink =
    dossier.orangecatLinks.find((link) => link.role === "funding") ??
    dossier.orangecatLinks.find((link) => link.role === "public_profile") ??
    dossier.orangecatLinks[0];
  // One derived answer to "is something being built?", from the runner's last
  // observation and the run ledger. Both the strip at the top of Now and the
  // kickoff gate read it, so they cannot disagree about whether to offer a
  // button — the hero and the strip must never both offer themselves as the
  // way to start this project.
  const buildStatus = deriveBuildStatus({
    state: dossier.state,
    runs: dossier.runs,
    commits: dossier.commits,
    nowMs: dossier.builtAtMs,
  });
  const showKickoff =
    !dossier.readonly &&
    needsKickoff({
      attrs,
      goalCount: detail.linkedGoals.length,
      goalsLocked: detail.goalsLocked,
      hasRepo: Boolean(links.repo),
      agentRunning: isBuildActive(buildStatus),
    });

  return (
    <div className="app-page max-w-5xl space-y-6">
      <AssistantContextBridge
        context={{
          projectId: project.id,
          name: project.name,
          workspaceKey,
          signals: healthSignals.map((signal) => ({
            key: HEALTH_SIGNAL_CONFIG.find((c) => c.kind === signal.kind)?.key ?? signal.kind,
            label: signal.label,
            value: signal.value,
          })),
          nextStep,
          timeoutStreak,
          readonly: dossier.readonly,
        }}
      />
      <Link
        href="/projects"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All projects
      </Link>

      {/* Destinations sit BELOW the identity, never beside it.
          Measured on a 1680px window before this change: the header was a
          `justify-between` row whose links column was `shrink-0`, so six ghost
          links took 607px of 960px — 63% — and squeezed the project's name and
          description into 333px. A 202-word description then wrapped into a
          twenty-line ribbon with two thirds of the screen empty beside it.
          That is what read as "a wall of text": mostly layout, not word count.

          A project's name and what it is outrank links to elsewhere, so they
          get the full measure and the links get a quiet row underneath. */}
      <header className="border-b border-border-subtle pb-6">
        <div className="flex flex-col gap-5">
          <ProjectWorkspaceHeader
            projectId={project.id}
            userProjectId={userProject?.id ?? null}
            name={project.name}
            workspaceKey={workspaceKey}
            description={cleanDescription(project.description)}
            status={attrs.status ?? null}
            health={health}
            readonly={dossier.readonly}
          />
          {/* One visual tier only: the header offers destinations, not actions,
              so everything here is a quiet ghost link. The page's real CTA
              (Make it happen, in the build strip or the kickoff hero) lives in
              the content flow below — five
              identical secondary buttons up here made it invisible.
              That was the stated rule but not the rendered one: LiveUrlField
              drew a bordered secondary button and OrangeCatPublishButton an
              unlabelled icon, so on a phone — where the row wraps to two lines
              — it read as four unrelated controls rather than one set. Both
              are ghost links with labels now. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <LiveUrlField
              userProjectId={userProject?.id ?? null}
              liveUrl={links.prodUrl}
              readonly={dossier.readonly}
            />
            {!dossier.readonly && (
              <RegisterSiteButton
                projectId={project.id}
                hasRepo={Boolean(userProject?.gitUrl ?? project.gitUrl)}
                liveUrl={userProject?.liveUrl ?? links.prodUrl}
              />
            )}
            {links.repo && (
              <a
                href={links.repo}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-ghost min-h-11 gap-1.5"
              >
                <GitBranch className="h-4 w-4" aria-hidden="true" /> Repository
              </a>
            )}
            {!dossier.readonly && (
              <ProjectPublicListingToggle
                projectId={project.id}
                listedPublicly={userProject?.listedPublicly ?? false}
              />
            )}
            {viewerIsSiteOperator && (
              <ProjectFeatureToggle
                projectId={project.id}
                featured={Boolean(userProject?.featuredAt)}
                listedPublicly={userProject?.listedPublicly ?? false}
              />
            )}
            {!dossier.readonly && <OrangeCatPublishButton projectId={project.id} />}
            {!dossier.readonly && <SolonFoundButton projectId={project.id} />}
            {primaryOrangeCatLink && (
              <a
                href={primaryOrangeCatLink.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-ghost min-h-11 gap-1.5"
                title="View, share, and fund this project on OrangeCat"
              >
                <Cat className="h-4 w-4 text-accent-text" aria-hidden />
                View and fund
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
            {shareAction}
          </div>
        </div>
      </header>

      {/* Tabs, not a scroll. Everything below used to stack into one page:
          measured at 2,698 words across 17 sections, of which ten answered
          variations of the same question. The old jump-nav indexed 6 of those
          17, which its own comment named as the failure — a nav that knows
          about some sections teaches the reader the others are not there.

          Anchors could not fix it either: scrolling into a wall still leaves
          the other 2,400 words underneath. A tab removes them. */}
      <ProjectTabs
        tabs={[
          {
            id: "now",
            label: "Now",
            count: healthSignals.length,
            urgent: healthSignals.length > 0,
            content: (
              <>
                <ProjectBuildStatus
                  status={buildStatus}
                  projectId={project.id}
                  workspaceKey={workspaceKey}
                  readonly={dossier.readonly}
                  setupNeeded={showKickoff}
                  hasNextStep={Boolean(nextStep)}
                />
                {!dossier.readonly && (
                  <ProjectKickoff
                    projectId={project.id}
                    projectName={project.name}
                    workspaceKey={workspaceKey}
                    description={cleanDescription(project.description)}
                    attrs={attrs}
                    goalCount={detail.linkedGoals.length}
                    goalsLocked={detail.goalsLocked}
                    hasRepo={Boolean(links.repo)}
                    needed={showKickoff}
                    autoStart={autoKickoff}
                  />
                )}
                <section className="scroll-mt-28" aria-labelledby="project-overview-title">
                  <h2 id="project-overview-title" className="sr-only">
                    Overview
                  </h2>
                  {healthSignals.length > 0 && (
                    <div className="mb-5 divide-y divide-border-subtle border-y border-border-subtle">
                      {healthSignals.map((signal) => {
                        const signalKey = HEALTH_SIGNAL_CONFIG.find(
                          (c) => c.kind === signal.kind,
                        )?.key;
                        return (
                          <div
                            key={signal.kind}
                            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-baseline sm:gap-3"
                          >
                            <span className="shrink-0 text-sm font-medium text-status-warning">
                              {signal.label}
                            </span>
                            <span className="flex-1 text-sm leading-relaxed text-text-secondary">
                              {signal.value}
                            </span>
                            {!dossier.readonly && signalKey && (
                              <FixSignalButton
                                projectId={project.id}
                                workspaceKey={workspaceKey}
                                signalKey={signalKey}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="grid gap-5 lg:grid-cols-2">
                    <NowSection dossier={dossier} interactive={false} showBrief={false} />
                    <NextSection
                      dossier={dossier}
                      interactive={false}
                      showGoals={false}
                      ownerView={!dossier.readonly}
                    />
                  </div>
                </section>
              </>
            ),
          },
          ...(!dossier.canEditFeedback
            ? []
            : [
                {
                  id: "feedback",
                  label: "Feedback",
                  content: (
                    <ProjectFeedbackSection projectId={project.id} projectName={project.name} />
                  ),
                },
              ]),
          {
            id: "plan",
            label: "Plan",
            content: (
              <ProjectPlanSection
                projectId={project.id}
                projectName={project.name}
                attrs={attrs}
                goalsLocked={detail.goalsLocked}
                goals={detail.linkedGoals}
                readonly={dossier.readonly}
              />
            ),
          },
          {
            id: "context",
            label: "Context",
            content: (
              <ProjectContextEditor
                projectId={project.id}
                projectName={workspaceKey}
                attrs={attrs}
                gitUrl={userProject?.gitUrl ?? project.gitUrl ?? null}
                resources={detail.resources ?? []}
                readonly={dossier.readonly}
              />
            ),
          },
          {
            id: "activity",
            label: "Activity",
            content: (
              <>
                <section className="ui-project-section" aria-labelledby="project-activity-title">
                  <h2
                    id="project-activity-title"
                    className="mb-4 text-lg font-semibold text-text-primary"
                  >
                    Activity and evidence
                  </h2>
                  <DoneSection dossier={dossier} />
                  {/* Funding is evidence, so it reads with the rest of the evidence
                      instead of above the project's own status. Rendered only when money
                      actually arrived — a "0 BTC · 0 contributions" panel was a headline
                      for nothing (the old formatter printed a bare `0` for empty). */}
                  {primaryOrangeCatLink &&
                    dossier.orangecatFunding &&
                    dossier.orangecatFunding.totalBtc > 0 && (
                      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-base p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="ui-micro-label">Confirmed on OrangeCat</div>
                          <div className="mt-1 text-xl font-semibold text-text-primary">
                            {formatBtc(dossier.orangecatFunding.totalBtc)} BTC
                          </div>
                          <div className="mt-1 text-sm text-text-secondary">
                            {dossier.orangecatFunding.contributorCount} confirmed{" "}
                            {dossier.orangecatFunding.contributorCount === 1
                              ? "contribution"
                              : "contributions"}
                          </div>
                        </div>
                        <a
                          href={primaryOrangeCatLink.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ui-btn-secondary min-h-11 gap-1.5"
                        >
                          Share and fund <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </div>
                    )}
                </section>
              </>
            ),
          },
          ...(dossier.readonly
            ? []
            : [
                {
                  id: "settings",
                  label: "Settings",
                  content: (
                    <ProjectSettingsPanel
                      projectId={project.id}
                      projectName={project.name}
                      hasRepo={Boolean(links.repo)}
                      repoUrl={links.repo}
                      hasLocalPath={Boolean(userProject?.dirPath)}
                      liveUrl={userProject?.liveUrl ?? links.prodUrl}
                    />
                  ),
                },
              ]),
        ]}
      />
    </div>
  );
}
