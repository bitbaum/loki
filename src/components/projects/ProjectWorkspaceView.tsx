import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ProjectDossier } from "@/db/queries/project-dossier";
import { ProjectWorkspaceHeader } from "./ProjectWorkspaceHeader";
import { ProjectIdentitySettings } from "./ProjectIdentitySettings";
import { ProjectConnectionsSection } from "./ProjectConnectionsSection";
import { ProjectPublishingSettings } from "./ProjectPublishingSettings";
import { ProjectTabs } from "./ProjectTabs";
import { ProjectContextEditor } from "./ProjectContextEditor";
import { ProjectFlags } from "./ProjectFlags";
import { ProjectPlanSection } from "./ProjectPlanSection";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { ProjectFeedbackSection } from "./ProjectFeedbackSection";
import { ProjectMembersPanel } from "./ProjectMembersPanel";
import { DoneSection, NextSection, NowSection } from "./ProjectDossierSections";
import { projectIsClientWork } from "@/lib/register/portfolio";
import { consentIso } from "@/lib/register/client-work";
import { ProjectListingInvitation } from "./ProjectListingInvitation";
import { shouldInviteToPublicCatalogue } from "@/lib/listing-invitation";
import { readAppsConf } from "@/lib/register/apps-conf";
import { studioRepoRoot } from "@/lib/site-cd-local";
import { siteAddresses } from "@/lib/site-domain";
import { getProjectLinks } from "./project-detail-types";
import { getHealthSignals, HEALTH_SIGNAL_CONFIG } from "./project-badges";
import { computeProjectHealth } from "@/lib/project-health";
import { FixSignalButton } from "./ProjectActionButtons";
import { ProjectKickoff } from "./ProjectKickoff";
import { CODE_CUSTODY } from "@/db/schema/user-projects";
import { ProjectInterview } from "./ProjectInterview";
import { AssistantContextBridge } from "./AssistantContextBridge";
import { needsKickoff } from "@/lib/project-kickoff";
import { needsInterview, planInterview } from "@/lib/project-interview";
import { kickoffAutoHref } from "@/lib/integrations/orangecat-handoff-mode";
import { deriveBuildStatus, isBuildActive } from "@/lib/project-build-status";
import { ProjectBuildStatus } from "./ProjectBuildStatus";
import { MemberGuide } from "./MemberGuide";
import { MemberProjectView } from "./MemberProjectView";
import { ProjectBuiltFrom } from "@/components/packages/ProjectBuiltFrom";
import { KitPlanPreview } from "./KitPlanPreview";
import { ProjectPlannedKits } from "./ProjectPlannedKits";
import { answer, cleanDescription, projectHeadline, projectTitle } from "@/lib/project-display";
import { formatBtc } from "@/lib/format";

export function ProjectWorkspaceView({
  dossier,
  shareAction,
  autoKickoff = false,
  autoInterview = false,
  viewerIsSiteOperator = false,
  ownerPass = null,
  memberPass = null,
  viewerMayOpenOrgRepo = false,
  viewerHasGithub = false,
  joined = false,
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
  /** A client's or viewer's own pass for the site (feedback/member-pass.ts). */
  memberPass?: string | null;
  /** The viewer holds a credential for the fleet's organisation, so a link
   *  to a private repository Loki keeps there opens for them. For everyone
   *  else that link is a 404, and is not shown. */
  viewerMayOpenOrgRepo?: boolean;
  /** The viewer has GitHub connected — where a code handover goes. */
  viewerHasGithub?: boolean;
  /** Arrived straight from accepting an invitation: the guide leads with it. */
  joined?: boolean;
}) {
  const { detail, userProject } = dossier;
  const project = detail.project;
  const attrs = detail.attrs;
  const workspaceKey = userProject?.name ?? project.name;
  const links = getProjectLinks(attrs, userProject?.gitUrl ?? project.gitUrl, userProject?.liveUrl);
  // Loki made and keeps this code (user_projects.code_custody). The person
  // may hold no GitHub account at all, so the page speaks of "the code", not
  // "the repository", and links to GitHub only where they can follow.
  const codeKeptByLoki = userProject?.codeCustody === CODE_CUSTODY.LOKI;
  const showRepoLink = Boolean(links.repo) && (!codeKeptByLoki || viewerMayOpenOrgRepo);
  // A site this studio serves can move to its own domain; the button names the
  // domain once it has one. The box's working register is read as well as the
  // shipped one: an attach writes there first and reaches the release only
  // after its register PR merges.
  const siteAddress = userProject?.liveUrl
    ? siteAddresses(userProject.liveUrl, [...readAppsConf(), ...readAppsConf(studioRepoRoot())])
    : null;
  const healthSignals = getHealthSignals(attrs, detail.attrMeta);
  const health = computeProjectHealth({
    description: project.description,
    gitUrl: userProject?.gitUrl ?? project.gitUrl,
    dirPath: userProject?.dirPath,
    liveUrl: userProject?.liveUrl,
    attrs,
    attrMeta: detail.attrMeta,
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
      hasRepo: Boolean(links.repo),
      agentRunning: isBuildActive(buildStatus),
    });

  // Client work stays private until the client agrees (lib/register/client-work.ts),
  // so listing it alone would not show it — say that, and do not invite.
  const clientWork = userProject ? projectIsClientWork(userProject, readAppsConf()) : false;
  const clientConsentAt = consentIso(userProject?.portfolioConsentAt);
  const awaitingClientConsent = clientWork && !clientConsentAt;

  // Ask once, per project, and only when there is something worth showing.
  // The rule is in lib/ so it is testable without a browser or a database.
  // Kickoff / active build owns the page — catalogue consent waits.
  const inviteToCatalogue =
    !awaitingClientConsent &&
    shouldInviteToPublicCatalogue({
      listedPublicly: userProject?.listedPublicly ?? false,
      dismissedAt: userProject?.listingPromptDismissedAt ?? null,
      isActive: userProject?.isActive ?? false,
      gitUrl: userProject?.gitUrl ?? project.gitUrl ?? null,
      readonly: dossier.readonly,
      buildBusy: showKickoff || isBuildActive(buildStatus),
    });

  // Attention-worthy flags outrank routine build state.
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

  const memberRole =
    dossier.readonly && (dossier.viewerRole === "client" || dossier.viewerRole === "viewer")
      ? dossier.viewerRole
      : null;

  return (
    <div className="app-page ui-project-workspace" data-fc-place="tab">
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
      <ProjectWorkspaceHeader
        projectId={project.id}
        name={projectTitle(project)}
        workspaceKey={workspaceKey}
        description={projectHeadline(project.description)}
        liveUrl={links.prodUrl}
        ownerPass={ownerPass}
        readonly={dossier.readonly}
        viewerRole={dossier.viewerRole}
        quiet={showKickoff}
      />

      {memberRole ? (
        <MemberProjectView
          projectId={project.id}
          role={memberRole}
          projectName={projectTitle(project)}
          ownerName={dossier.ownerName}
          liveUrl={userProject?.liveUrl ?? links.prodUrl}
          ownerPass={ownerPass}
          memberPass={memberPass}
          joined={joined}
          ready={dossier.viewerReady}
          status={buildStatus}
          workspaceKey={workspaceKey}
        />
      ) : (
        <ProjectTabs
          tabs={[
            {
              id: "now",
              label: "Overview",
              // The member's ask box (MemberGuide), reached from the header and
              // from Today / Control by /projects/<id>#ask.
              anchors: ["ask"],
              count: healthSignals.length,
              urgent: healthSignals.length > 0,
              content: (
                <>
                  {flagsBlock}
                  {dossier.readonly && dossier.viewerRole && dossier.viewerRole !== "owner" && (
                    <MemberGuide
                      projectId={project.id}
                      role={dossier.viewerRole}
                      projectName={projectTitle(project)}
                      ownerName={dossier.ownerName}
                      liveUrl={userProject?.liveUrl ?? links.prodUrl}
                      ownerPass={ownerPass}
                      memberPass={memberPass}
                      joined={joined}
                      ready={dossier.viewerReady}
                    />
                  )}
                  <ProjectBuildStatus
                    status={buildStatus}
                    liveUrl={userProject?.liveUrl ?? links.prodUrl}
                    projectId={project.id}
                    workspaceKey={workspaceKey}
                    readonly={dossier.readonly}
                    setupNeeded={showKickoff}
                    hasNextStep={Boolean(nextStep)}
                  />
                  {!dossier.readonly && (links.prodUrl || links.repo || userProject?.dirPath) && (
                    <section
                      className="ui-project-section flex flex-wrap items-center justify-between gap-4"
                      aria-label="Project review"
                    >
                      <div>
                        <h2 className="text-lg font-semibold">See it through your users’ eyes</h2>
                        <p className="mt-1 text-base text-text-secondary">
                          Review the site with Loki and choose what to improve.
                        </p>
                      </div>
                      <Link
                        href={`/projects/${project.id}/review`}
                        className="ui-btn-secondary min-h-11"
                      >
                        Review project →
                      </Link>
                    </section>
                  )}
                  {!dossier.readonly && (!showKickoff || autoInterview) && (
                    <ProjectInterview
                      projectId={project.id}
                      needed={needsInterview({ attrs })}
                      planned={planInterview({ attrs }).map((field) => field.id)}
                      autoStart={autoInterview}
                      kickoffHref={kickoffAutoHref(`/projects/${project.id}`)}
                    />
                  )}
                  {!dossier.readonly && !autoInterview && (
                    <ProjectKickoff
                      projectId={project.id}
                      projectName={project.name}
                      workspaceKey={workspaceKey}
                      description={cleanDescription(project.description)}
                      attrs={attrs}
                      goalCount={detail.linkedGoals.length}
                      hasRepo={Boolean(links.repo)}
                      needed={showKickoff}
                      autoStart={autoKickoff}
                      interviewHref={
                        needsInterview({ attrs }) ? `/projects/${project.id}?interview=1` : null
                      }
                      firstTarget={
                        detail.linkedGoals
                          .slice()
                          .sort(
                            (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
                          )
                          .find((g) => (g.progress ?? 0) < 100)?.title ?? null
                      }
                    />
                  )}
                  {showKickoff && <KitPlanPreview dossier={dossier} clientWork={clientWork} />}
                  {!showKickoff && (
                    <section className="scroll-mt-28" aria-labelledby="project-overview-title">
                      <h2 id="project-overview-title" className="sr-only">
                        Overview
                      </h2>
                      <div className="space-y-5">
                        <NextSection
                          dossier={dossier}
                          interactive={false}
                          showGoals={false}
                          ownerView={!dossier.readonly}
                        />
                      </div>
                    </section>
                  )}
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
                  <ProjectIdentitySettings
                    projectId={project.id}
                    name={projectTitle(project)}
                    userProjectId={userProject?.id ?? null}
                    description={cleanDescription(project.description)}
                    status={attrs.status ?? null}
                    health={health}
                    readonly={dossier.readonly}
                  />
                  <ProjectContextEditor
                    projectId={project.id}
                    projectName={workspaceKey}
                    attrs={attrs}
                    gitUrl={userProject?.gitUrl ?? project.gitUrl ?? null}
                    resources={detail.resources ?? []}
                    readonly={dossier.readonly}
                  />
                  <div className="mt-7">
                    <ProjectBuiltFrom
                      userProjectId={userProject?.id ?? null}
                      hasRepo={Boolean(userProject?.gitUrl)}
                      readonly={dossier.readonly || !ownerPass}
                    />
                    {userProject && (
                      <ProjectPlannedKits
                        ownerId={dossier.ownerId}
                        entityProjectId={project.id}
                        userProjectId={userProject.id}
                        plan={userProject.kitPlan ?? null}
                      />
                    )}
                  </div>
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
                    <NowSection dossier={dossier} interactive={false} showBrief={false} />
                    <DoneSection dossier={dossier} />
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
                  // Who else is in it — its own tab, one tap from the header's
                  // Invite button, not a panel at the bottom of Settings.
                  {
                    id: "people",
                    label: "People",
                    content: (
                      <ProjectMembersPanel
                        projectId={project.id}
                        projectName={projectTitle(project)}
                        defaultRole={userProject?.clientWork ? "client" : "viewer"}
                      />
                    ),
                  },
                  {
                    id: "settings",
                    label: "Settings",
                    content: (
                      <>
                        <ProjectConnectionsSection
                          projectId={project.id}
                          userProjectId={userProject?.id ?? null}
                          liveUrl={links.prodUrl}
                          repoUrl={showRepoLink ? links.repo : null}
                          hasRepo={Boolean(links.repo)}
                          ownerPass={ownerPass}
                          siteAddress={siteAddress}
                        />
                        <ProjectPublishingSettings
                          projectId={project.id}
                          userProject={userProject}
                          clientWork={clientWork}
                          clientConsentAt={clientConsentAt}
                          awaitingClientConsent={awaitingClientConsent}
                          viewerIsSiteOperator={viewerIsSiteOperator}
                          shareAction={shareAction}
                        />
                        {inviteToCatalogue && <ProjectListingInvitation projectId={project.id} />}
                        <ProjectSettingsPanel
                          projectId={project.id}
                          projectName={project.name}
                          hasRepo={Boolean(links.repo)}
                          repoUrl={links.repo}
                          hasLocalPath={Boolean(userProject?.dirPath)}
                          liveUrl={userProject?.liveUrl ?? links.prodUrl}
                          codeKeptByLoki={codeKeptByLoki}
                          hasGithub={viewerHasGithub}
                        />
                      </>
                    ),
                  },
                ]),
          ]}
        />
      )}
    </div>
  );
}
