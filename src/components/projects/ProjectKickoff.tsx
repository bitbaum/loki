"use client";

/**
 * "Make it happen" — the one control that starts a project.
 *
 * Everything this runs already existed on the page, scattered: AI profile fill
 * (a chip in Context), milestone generation (a second chip inside that chip's
 * drawer), repo provisioning (inside a collapsed Project settings block), and
 * dispatch (a link to another page). A person with an idea and a paragraph
 * describing it had to find four controls and know their order. This runs them
 * in that order, from the description they already wrote, and reports each one
 * as it lands — so a partial failure still says exactly what got done.
 *
 * The plan comes from lib/project-kickoff, the same module that decides whether
 * this hero renders at all, so the button can never do more or less than the
 * page claims it will.
 */

import { useEffect, useRef, useState } from "react";
import { GetHelpLine } from "./GetHelpLine";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Rocket, Zap } from "lucide-react";
import { useSiteDeployment } from "@/hooks/use-site-deployment";
import { SiteDeploymentStatus } from "./SiteDeploymentStatus";
import { DOC_PASTE_MAX } from "@/lib/constants";
import { CharCount } from "@/components/ui/char-count";
import { LinkGithubButton } from "@/components/onboarding/LinkGithubButton";
import { kickoffAutoHref } from "@/lib/integrations/orangecat-handoff-mode";
import {
  KICKOFF_STEP_LABEL,
  hasKickoffSource,
  isThinBrief,
  planKickoff,
} from "@/lib/project-kickoff";
import {
  clearKickoffRun,
  startKickoff,
  useKickoffRun,
  type KickoffRun,
  type KickoffStepState,
} from "@/lib/kickoff-run";

export function ProjectKickoff({
  projectId,
  projectName,
  workspaceKey,
  description,
  attrs,
  goalCount,
  hasRepo,
  needed,
  autoStart = false,
  interviewHref = null,
  firstTarget = null,
}: {
  projectId: string;
  projectName: string;
  workspaceKey: string;
  /** The project's own description — the brief an agent gets briefed from. */
  description: string | null;
  attrs: Record<string, string>;
  goalCount: number;
  hasRepo: boolean;
  /** Server-computed needsKickoff. Once a run has started this card stays put
   *  regardless: the refresh that follows a successful kickoff flips `needed`
   *  to false, and unmounting would take the result and the "watch it work"
   *  link with it. */
  needed: boolean;
  /** Start on mount when the plan can run — the OrangeCat one-click path. The
   *  same run() the button calls: no second orchestrator. */
  autoStart?: boolean;
  /** Where the optional "answer a few questions first" link goes; null hides it. */
  interviewHref?: string | null;
  /** The next open milestone — what the agent aims at first. */
  firstTarget?: string | null;
}) {
  const router = useRouter();
  // Seeded with the project's own description, and editable from here. It used
  // to be hidden whenever a description existed, which meant a one-sentence
  // description became the entire brief with no way to improve it on the page
  // that runs on it — Zeitkastli's real brief had to be written straight to
  // the database. Everything below is derived from this text, so this text is
  // the thing to put in front of the person, not behind a length check.
  const [text, setText] = useState(description ?? "");
  // Shown once, not twice: the header already prints the description, so a
  // brief that is there and substantial starts as a short preview with Edit.
  // The textarea opens straight away only when there is little or nothing to
  // start from — that is when writing IS the next step.
  const [editingBrief, setEditingBrief] = useState(
    !hasKickoffSource(description) || isThinBrief(description),
  );
  const [wantRepo, setWantRepo] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [repoOptionsOpen, setRepoOptionsOpen] = useState(false);
  const { deployment, setDeployment } = useSiteDeployment(projectId);
  // The run lives in lib/kickoff-run, not here: it must outlive this card when
  // the person goes to watch Terminal or Control mid-run, and be here again,
  // live, when they come back.
  const kickoff = useKickoffRun(projectId);
  const steps = kickoff?.steps ?? null;
  const running = kickoff?.running ?? false;
  const finished = kickoff?.finished ?? false;

  useEffect(() => {
    if (kickoff?.deployment) setDeployment(kickoff.deployment);
  }, [kickoff?.deployment, setDeployment]);

  // The server runs the steps; when it settles, bring the page (profile,
  // repo, build status) in line with what landed. Keyed on the transition so
  // a run discovered already-finished does not refresh on every visit.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current && finished) {
      wasRunning.current = false;
      router.refresh();
    }
  }, [running, finished, router]);

  const source = text.trim() || null;
  const plan = planKickoff({
    attrs,
    goalCount,
    hasRepo,
    wantRepo: !hasRepo && wantRepo,
  });
  // The brief is always shown: every step reads it, dispatch included, so a
  // project whose plan is only "repo + dispatch" still deserves a say in what
  // gets built. It is only *required* by the steps that are extracted from it.
  const requiresSource = plan.includes("profile") || plan.includes("milestones");
  const ready = !requiresSource || hasKickoffSource(source);

  function run() {
    // The server runs it; this card only watches (lib/kickoff-run).
    void startKickoff(projectId, { names: [workspaceKey, projectName], plan, source, visibility });
  }

  // Auto-start fires once, and only when a press would have been allowed. A
  // brief too thin to extract from stays put and shows the same hint the
  // button shows — starting on nothing would just fail four steps in a row.
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoStart || autoFired.current || !needed || !ready || running || steps) return;
    autoFired.current = true;
    void run();
    // run() reads the current plan/brief; those are exactly the values gating this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, needed, ready, running, steps]);

  const failures = (steps ?? []).filter((s) => s.state === "failed");

  if (!needed && !steps) return null;

  return (
    <section className="ui-card-shell space-y-4 p-4 sm:p-5" aria-labelledby="project-kickoff-title">
      <div>
        <p className="ui-kicker">Start</p>
        <h2 id="project-kickoff-title" className="text-lg font-semibold text-text-primary">
          Make it happen
        </h2>
        {!steps && (
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            One tap sets it up — {plan.map((id) => KICKOFF_STEP_LABEL[id].toLowerCase()).join(", ")}
            . Everything it writes stays editable.
          </p>
        )}
        {!steps && firstTarget && (
          <p className="mt-2 text-sm text-text-primary">
            <span className="text-text-secondary">First target: </span>
            {firstTarget}
          </p>
        )}
      </div>

      {!steps && !editingBrief && (
        <div className="rounded-lg border border-border-subtle bg-surface-raised p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="ui-micro-label">Brief</span>
            <button
              type="button"
              onClick={() => setEditingBrief(true)}
              className="ui-btn-ghost ui-btn-xs"
            >
              Edit
            </button>
          </div>
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-text-secondary">{text}</p>
        </div>
      )}

      {!steps && editingBrief && (
        <div className="space-y-1.5">
          <label htmlFor="project-kickoff-brief" className="ui-micro-label">
            The brief — everything is written from this
          </label>
          <textarea
            id="project-kickoff-brief"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={running}
            placeholder={`What is ${projectName}, who is it for, and what should exist at the end? A paragraph is plenty — everything else is derived from it.`}
            className="ui-input w-full text-base leading-relaxed sm:text-sm"
          />
          <CharCount length={text.length} max={DOC_PASTE_MAX} />
          {isThinBrief(text) && (
            <p className="text-xs text-text-secondary">
              That is about a sentence. It will run, but the result can only be as specific as this
              is — say who it is for and what should exist at the end.
            </p>
          )}
        </div>
      )}

      {/* The repository choice used to be a bordered box of checkbox, select
          and a two-sentence explanation — the most visible thing on the card
          after the button, for a default almost nobody changes. One line says
          what will happen; Change opens the controls. */}
      {!steps && !hasRepo && !repoOptionsOpen && (
        <p className="text-xs text-text-secondary">
          {wantRepo
            ? `Also creates a ${visibility} GitHub repository for the code.`
            : "No repository — an agent can plan, but has nowhere to write code."}{" "}
          <button
            type="button"
            onClick={() => setRepoOptionsOpen(true)}
            className="font-medium text-text-primary underline-offset-2 hover:underline"
          >
            Change
          </button>
        </p>
      )}
      {!steps && !hasRepo && repoOptionsOpen && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised p-3">
          <label className="flex min-h-11 items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={wantRepo}
              onChange={(e) => setWantRepo(e.target.checked)}
              className="h-5 w-5 shrink-0"
            />
            Create the GitHub repository
          </label>
          {wantRepo && (
            <select
              className="ui-input-compact"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "private" | "public")}
              aria-label="Repository visibility"
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          )}
        </div>
      )}

      {!steps && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={!ready}
            className="ui-btn-primary gap-2 px-5 py-3 text-base"
          >
            <Zap className="h-4 w-4" aria-hidden="true" /> Make it happen
          </button>
          {!ready && (
            <span className="text-xs text-text-secondary">
              Write a sentence about the project first — that is the whole brief.
            </span>
          )}
          {ready && interviewHref && (
            <Link href={interviewHref} className="ui-btn-ghost text-sm">
              Sharpen it first: 5 quick questions
            </Link>
          )}
        </div>
      )}

      {steps && (
        <ol className="space-y-2.5 border-t border-border-subtle pt-3" aria-live="polite">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5">
                <StepIcon state={s.state} />
              </span>
              {/* Label above note, never beside it: side by side, a phone
                  squeezed both into two narrow columns ("Filling the /
                  profile" next to a wrapped error) and neither read. */}
              <span className="min-w-0 flex-1">
                <span
                  className={
                    s.state === "pending" ? "block text-text-tertiary" : "block text-text-primary"
                  }
                >
                  {KICKOFF_STEP_LABEL[s.id]}
                </span>
                {s.note && (
                  <span
                    className={
                      s.state === "failed"
                        ? "ui-error block text-xs wrap-anywhere"
                        : "block text-xs text-text-secondary wrap-anywhere"
                    }
                  >
                    {s.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* One quiet line under the steps, aligned with their labels. It was a
          four-line paragraph with its own spinner — a second "working"
          beside the step that is already spinning, hanging off its own
          left edge (operator, 2026-10-07). */}
      {running && (
        <p className="pl-6.5 text-xs text-text-tertiary">
          Runs on Loki — you can close this page; it keeps going.
        </p>
      )}

      <SiteDeploymentStatus deployment={deployment} />

      {finished && kickoff && (
        <KickoffNextStep
          outcome={kickoff.dispatch}
          interrupted={kickoff.interrupted}
          needsGithub={kickoff.needsGithub}
          needsBuilder={kickoff.needsBuilder}
          failures={failures.length}
          projectId={projectId}
          onRetry={run}
          onDismiss={() => clearKickoffRun(projectId)}
          brief={{ changes: text }}
        />
      )}
    </section>
  );
}

function StepIcon({ state }: { state: KickoffStepState }) {
  if (state === "running")
    return (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent-text" aria-hidden="true" />
    );
  if (state === "done")
    return <Check className="h-4 w-4 shrink-0 text-status-positive" aria-hidden="true" />;
  if (state === "failed")
    return <AlertCircle className="h-4 w-4 shrink-0 text-status-negative" aria-hidden="true" />;
  // Same 16px box as the icons, so a pending step's label lines up with the
  // rest instead of sitting a few pixels off.
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
      <span className="ui-dot ui-dot-neutral" />
    </span>
  );
}

/**
 * One next action, chosen by where the agent actually went — never a generic
 * "Watch it work" into a Terminal that has nothing to show yet.
 */
function KickoffNextStep({
  outcome,
  interrupted,
  needsGithub,
  needsBuilder,
  failures,
  projectId,
  onRetry,
  onDismiss,
  brief,
}: {
  outcome: KickoffRun["dispatch"];
  interrupted?: boolean;
  needsGithub?: boolean;
  needsBuilder?: boolean;
  failures: number;
  projectId: string;
  onRetry: () => void;
  onDismiss: () => void;
  /** What the studio would be handed, if the person asks people instead. */
  brief?: { website?: string | null; changes?: string | null } | null;
}) {
  const dismiss = (
    <button type="button" onClick={onDismiss} className="ui-btn-ghost ui-btn-xs">
      Hide this
    </button>
  );

  if (needsGithub) {
    // The one fix, as the one button: connecting GitHub returns here with
    // ?kickoff=auto, so the build resumes by itself from the step that stopped.
    return (
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <p className="text-sm font-medium text-text-primary">
          Connect GitHub and the build carries on.
        </p>
        <p className="text-xs leading-relaxed text-text-secondary">
          The code for this project lives in a GitHub repository. Connect your account and you come
          straight back here — everything above is saved, and the build picks up where it stopped.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LinkGithubButton callbackUrl={kickoffAutoHref(`/projects/${projectId}`)} />
          {dismiss}
        </div>
      </div>
    );
  }

  if (outcome === "running") {
    return (
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <p className="text-sm font-medium text-text-primary">An agent is on it.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${projectId}/watch`} className="ui-btn-primary gap-2">
            <Rocket className="h-4 w-4" aria-hidden="true" /> Watch it work
          </Link>
          {dismiss}
        </div>
        {failures > 0 && (
          <p className="text-xs text-text-secondary">
            Anything marked above can be filled in later on this page — it does not stop the agent.
          </p>
        )}
      </div>
    );
  }

  if (needsBuilder) {
    // Refused, not queued: nothing waits anywhere, so the copy must not say it
    // starts by itself. The way forward is the person's own computer.
    return (
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <p className="text-sm font-medium text-text-primary">
          Connect your computer to start the build.
        </p>
        <p className="text-xs leading-relaxed text-text-secondary">
          Loki&apos;s shared cloud builder is not open to every account yet, so the agent runs on
          your own computer. Install Fleet Runner, then press Try again here — everything above is
          saved.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/download" className="ui-btn-primary">
            Connect your computer
          </Link>
          <button type="button" onClick={onRetry} className="ui-btn-secondary gap-2">
            <Zap className="h-4 w-4" aria-hidden="true" /> Try again
          </button>
          {dismiss}
        </div>
      </div>
    );
  }

  if (outcome === "queued-offline") {
    return (
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <p className="text-sm font-medium text-text-primary">
          Your agent is queued, waiting for a builder.
        </p>
        <p className="text-xs leading-relaxed text-text-secondary">
          No builder is connected right now, so nothing is running yet — the work is saved and
          starts by itself the moment the cloud builder or your computer comes online.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/download" className="ui-btn-primary">
            Connect your computer
          </Link>
          <Link href={`/projects/${projectId}/watch`} className="ui-btn-secondary">
            Watch for it
          </Link>
          {dismiss}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border-subtle pt-3">
      <p className="text-sm font-medium text-text-primary">
        {interrupted
          ? "Loki restarted before this finished (usually an update going out)."
          : "No agent was started yet."}
      </p>
      <p className="text-xs leading-relaxed text-text-secondary">
        Everything marked done above is saved. Trying again only redoes what is missing.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onRetry} className="ui-btn-primary gap-2">
          <Zap className="h-4 w-4" aria-hidden="true" /> Try again
        </button>
        {dismiss}
      </div>
      <GetHelpLine brief={brief} />
    </div>
  );
}
