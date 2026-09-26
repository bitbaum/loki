import Link from "next/link";
import { ArrowLeft, Cat, ExternalLink, GitBranch } from "lucide-react";
import type { ProjectDossier } from "@/db/queries/project-dossier";
import { ProjectWorkspaceHeader } from "./ProjectWorkspaceHeader";
import { ProjectTabs } from "./ProjectTabs";
import { ProjectContextEditor } from "./ProjectContextEditor";
import { ProjectFlags } from "./ProjectFlags";
import { ProjectPlanSection } from "./ProjectPlanSection";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { ProjectFeedbackSection } from "./ProjectFeedbackSection";
import { ProjectMembersPanel } from "./ProjectMembersPanel";
import { DoneSection, NextSection, NowSection } from "./ProjectDossierSections";
import { OrangeCatPublishButton } from "./OrangeCatPublishButton";
import { ProjectPublicListingToggle } from "./ProjectPublicListingToggle";
import { ProjectFeatureToggle } from "./ProjectFeatureToggle";
import { ProjectListingInvitation } from "./ProjectListingInvitation";
import { shouldInviteToPublicCatalogue } from "@/lib/listing-invitation";
import { SolonFoundButton } from "./SolonFoundButton";
import { LiveUrlField } from "./LiveUrlField";
import { RegisterSiteButton } from "./RegisterSiteButton";
import { getProjectLinks } from "./project-detail-types";
import { getHealthSignals, HEALTH_SIGNAL_CONFIG } from "./project-badges";
import { computeProjectHealth } from "@/lib/project-health";
import { FixSignalButton } from "./ProjectActionButtons";
import { ProjectKickoff } from "./ProjectKickoff";
import { ProjectInterview } from "./ProjectInterview";
import { ProjectShareMenu } from "./ProjectShareMenu";
import { AssistantContextBridge } from "./AssistantContextBridge";
import { needsKickoff } from "@/lib/project-kickoff";
import { needsInterview, planInterview } from "@/lib/project-interview";
import { kickoffAutoHref } from "@/lib/integrations/orangecat-handoff-mode";
import { deriveBuildStatus, isBuildActive } from "@/lib/project-build-status";
import { ProjectBuildStatus } from "./ProjectBuildStatus";
import { answer, cleanDescription, projectHeadline } from "@/lib/project-display";
import { formatBtc } from "@/lib/format";

export function ProjectWorkspaceView({
  dossier,
  shareAction,
  autoKickoff = false,
  autoInterview = false,
  viewerIsSiteOperator = false,
  ownerPass = null,
}: {
  dossier: ProjectDossier;
  shareAction?: React.ReactNode;
  /** Arrived from a one-click build (OrangeCat handoff): start the kickoff without a press. */
  autoKickoff?: boolean;
  /** Arrived on a project the handoff just CREATED: ask before building. */
  autoInterview?: boolean;
  /** Viewer runs this Loki instance, so they may curate its landing page. */
  viewerIsSiteOperator?: boolean;
  /** Signed server-side for the project's owner only (feedback/owner-pass.ts). */
  ownerPass?: string | null;
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

  // Ask once, per project, and only when there is something worth showing.
  // The rule is in lib/ so it is testable without a browser or a database.
  // Kickoff / active build owns the page — catalogue consent waits.
  const inviteToCatalogue = shouldInviteToPublicCatalogue({
    listedPublicly: userProject?.listedPublicly ?? false,
    dismissedAt: userProject?.listingPromptDismissedAt ?? null,
    isActive: userProject?.isActive ?? false,
    gitUrl: userProject?.gitUrl ?? project.gitUrl ?? null,
    readonly: dossier.readonly,
    buildBusy: showKickoff || isBuildActive(buildStatus),
  });

  /**
   * WHAT IS WRONG, ABOVE WHAT IS HAPPENING.
   *
   * Measured on production 2026-09-22 (evig): the Now tab opened with
   * "BUILD — Nothing is being built right now" in the page's largest type
   * beside its only orange button, and THREE live flags sat underneath it as
   * plain rows — the first of them "Email verification bypass: anyone can
   * register @revamp-it.ch domain and get Staff role with admin access to 14
   * areas".
   *
   * That is the same fault /today had: the surface reported the MACHINE'S
   * status where the reader was asking what needs them. Idle is not news.
   * A security hole is.
   *
   * So the flags lead WHEN THERE ARE FLAGS, and the build status leads when
   * there are none — at which point "nothing is being built" is genuinely
   * the most useful thing the tab can say.
   *
   * Raising, editing and clearing still live in <ProjectFlags> further down,
   * which is ALWAYS rendered: "how do I flag this?" had no answer anywhere in
   * the product, and a control that only appears once the thing has already
   * happened cannot be that answer.
   */
  const flagsBlock =
    healthSignals.length > 0 ? (
      <section className="ui-project-flags-lead" aria-labelledby="project-flags-title">
        <h2 id="project-flags-title" className="ui-section-label text-status-warning">
          {healthSignals.length === 1
            ? "1 flag on this project"
            : `${healthSignals.length} flags on this project`}
        </h2>
        <div className="divide-y divide-border-subtle">
          {healthSignals.map((signal) => {
            const signalKey = HEALTH_SIGNAL_CONFIG.find((c) => c.kind === signal.kind)?.key;
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
      </section>
    ) : null;

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
            description={projectHeadline(project.description)}
            status={attrs.status ?? null}
            health={health}
            readonly={dossier.readonly}
          />
          {/* The row holds what an owner opens every day — the live site and the
              repository — and ONE door for taking the project public. Four
              such doors used to sit here as peers (List publicly, Publish,
              Govern, Share) with nothing saying how they differ; George read
              the row as a Frankenstein (2026-09-25). The "Live site set" chip
              went too: the Live link says the same thing, and does something. */}
          {!dossier.readonly && !links.prodUrl && (userProject?.gitUrl || project.gitUrl) && (
            <p className="text-sm text-text-secondary">No live URL yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <LiveUrlField
              userProjectId={userProject?.id ?? null}
              liveUrl={links.prodUrl}
              readonly={dossier.readonly}
              ownerPass={ownerPass}
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
          </div>
          {!dossier.readonly && (
            <ProjectShareMenu
              destinations={[
                {
                  key: "link",
                  title: "A link to send",
                  explain:
                    "A read-only page for someone without an account. You choose what it shows.",
                  control: shareAction ?? null,
                },
                {
                  key: "catalogue",
                  title: userProject?.listedPublicly
                    ? "Listed in Loki's catalogue"
                    : "Loki's catalogue",
                  explain: userProject?.listedPublicly
                    ? "Shown on the public fleet page, credited to you."
                    : "Not listed. Listing shows it on the public fleet page, credited to you.",
                  control: (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ProjectPublicListingToggle
                        projectId={project.id}
                        listedPublicly={userProject?.listedPublicly ?? false}
                      />
                      {viewerIsSiteOperator && (
                        <ProjectFeatureToggle
                          projectId={project.id}
                          featured={Boolean(userProject?.featuredAt)}
                          listedPublicly={userProject?.listedPublicly ?? false}
                        />
                      )}
                    </span>
                  ),
                },
                {
                  key: "orangecat",
                  title: "OrangeCat",
                  explain: "A public page where people can follow, share and fund it.",
                  control: <OrangeCatPublishButton projectId={project.id} />,
                },
                {
                  key: "solon",
                  title: "Solon",
                  explain:
                    "Found it as a venture others govern with you. Signed with your own wallet, so Loki hands you over.",
                  control: <SolonFoundButton projectId={project.id} />,
                },
              ]}
            />
          )}
        </div>
      </header>

      {/* Tabs, not a scroll. Everything below used to stack into one page:
          measured at 2,698 words across 17 sections, of which ten answered
          variations of the same question. The old jump-nav indexed 6 of those
          17, which its own comment named as the failure — a nav that knows
          about some sections teaches the reader the others are not there.

          Anchors could not fix it either: scrolling into a wall still leaves
          the other 2,400 words underneath. A tab removes them. */}
      {inviteToCatalogue && <ProjectListingInvitation projectId={project.id} />}

      <ProjectTabs
        tabs={[
          {
            id: "now",
            label: "Now",
            count: healthSignals.length,
            urgent: healthSignals.length > 0,
            content: (
              <>
                {flagsBlock}
                <ProjectBuildStatus
                  status={buildStatus}
                  projectId={project.id}
                  workspaceKey={workspaceKey}
                  readonly={dossier.readonly}
                  setupNeeded={showKickoff}
                  hasNextStep={Boolean(nextStep)}
                />
                {/* Before the kickoff, not beside it: every step below reads the
                    profile, so the questions are worth asking first. It renders
                    only while essential fields are still blank. */}
                {!dossier.readonly && (
                  <ProjectInterview
                    projectId={project.id}
                    needed={needsInterview({ attrs })}
                    planned={planInterview({ attrs }).map((field) => field.id)}
                    autoStart={autoInterview}
                    kickoffHref={kickoffAutoHref(`/projects/${project.id}`)}
                  />
                )}
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
          {
            // The project's story: why it exists, who it is for, what it
            // does. Every dispatch briefs the agent from these fields, so this
            // is where an owner TELLS the project — and it was "Context", tab 4
            // of 6, behind Feedback and Plan. George, 2026-09-25, looking for
            // exactly this on Skif: "where would I tell the story?" The id stays
            // `context` so #context links keep working.
            id: "context",
            label: "Story",
            content: (
              <>
                <ProjectContextEditor
                  projectId={project.id}
                  projectName={workspaceKey}
                  attrs={attrs}
                  gitUrl={userProject?.gitUrl ?? project.gitUrl ?? null}
                  resources={detail.resources ?? []}
                  readonly={dossier.readonly}
                />
                {/* On Context, beside the other things a person WRITES about a
                    project. The three flag attrs are excluded from the
                    "Additional context" block by design (a dedicated UI owns
                    them) — and until now that dedicated UI did not exist, so
                    the exclusion just meant there was nowhere to raise one. */}
                <div className="mt-7">
                  <ProjectFlags
                    projectId={project.id}
                    attrs={attrs}
                    attrMeta={detail.attrMeta}
                    readonly={dossier.readonly}
                  />
                </div>
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
                    <>
                      {/* Who has access lives in Settings, where every other
                          product puts it. It used to be a collapsed "Editors"
                          disclosure inside the Feedback tab, where the owner
                          looking for "invite someone" did not find it. */}
                      <ProjectMembersPanel projectId={project.id} />
                      <ProjectSettingsPanel
                        projectId={project.id}
                        projectName={project.name}
                        hasRepo={Boolean(links.repo)}
                        repoUrl={links.repo}
                        hasLocalPath={Boolean(userProject?.dirPath)}
                        liveUrl={userProject?.liveUrl ?? links.prodUrl}
                      />
                    </>
                  ),
                },
              ]),
        ]}
      />
    </div>
  );
}
