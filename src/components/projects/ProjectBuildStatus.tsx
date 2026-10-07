/**
 * The first thing on a project's Now tab: is something being built, and if
 * not, the one button that starts it.
 *
 * Server component on purpose. Every line here is relative time ("started 9m
 * ago"), and rendering that in a client component hydrates against a second
 * clock. The button is the only interactive part and lives in
 * ProjectActionButtons.
 *
 * Copy rule: say what is known, from the run ledger and the runner's last
 * observation, and nothing else — and say it as an outcome. The words are
 * lib/project-state-sentence (one sentence per project, ending on "live" or
 * "waiting on you"); what each state requires as evidence is
 * lib/project-build-status. This strip used to compose its own copy and
 * ended on "work reached the repo", which is true and not what the person
 * who asked for the change wanted to know.
 */
import Link from "next/link";
import { Rocket } from "lucide-react";
import type { BuildStatus } from "@/lib/project-build-status";
import { projectStateSentence } from "@/lib/project-state-sentence";
import { MakeItHappenButton } from "./ProjectActionButtons";

export function ProjectBuildStatus({
  status,
  liveUrl,
  projectId,
  workspaceKey,
  readonly,
  setupNeeded,
  hasNextStep,
}: {
  status: BuildStatus;
  /** Where the project is served, so "live" can say where. */
  liveUrl?: string | null;
  projectId: string;
  workspaceKey: string;
  readonly: boolean;
  /** The kickoff hero renders right below with its own Make it happen — when
   *  it does, this strip reports state and offers no second button. */
  setupNeeded: boolean;
  /** A queued next step exists, so the button runs it; otherwise it briefs an
   *  agent from the description (the kickoff prompt). */
  hasNextStep: boolean;
}) {
  // Setup still missing and nothing running: the hero below already says
  // "nothing built yet, press here". A second card saying the same thing on
  // top of it is the two-CTA layout this strip exists to remove.
  if (setupNeeded && status.kind === "idle") return null;

  const canStart = !readonly && !setupNeeded;
  const sentence = projectStateSentence(status, { liveUrl });
  const tone =
    sentence.tone === "working" || sentence.tone === "live"
      ? "ui-dot-positive"
      : sentence.tone === "waiting"
        ? "ui-dot-warning"
        : "ui-dot-neutral";
  const { headline, detail } = sentence;
  const KICKER = { live: "Live", working: "Build", waiting: "Waiting on you", quiet: "Build" };
  // Where to look, beside the sentence: the site once it is live, the change
  // while it is on its way. The action slot stays the one button that starts
  // work, so this is a link in the text, never a second button.
  const shipping = status.kind === "idle" ? status.last?.shipping : null;
  const look =
    sentence.tone === "live" && liveUrl
      ? { href: liveUrl, label: "Open the site" }
      : shipping?.prUrl && !sentence.waitingOnYou
        ? { href: shipping.prUrl, label: "See the change" }
        : null;

  let action: React.ReactNode = null;
  if (status.kind === "building") {
    action = (
      <Link href={`/projects/${projectId}/watch`} className="ui-btn-secondary min-h-11 gap-2">
        <Rocket className="h-4 w-4" aria-hidden="true" /> Watch it work
      </Link>
    );
  } else if (status.kind === "queued") {
    action = (
      <Link href={`/projects/${projectId}/watch`} className="ui-btn-secondary min-h-11">
        Watch it start
      </Link>
    );
  }
  if (canStart && (status.kind === "idle" || status.kind === "stalled")) {
    action = (
      <MakeItHappenButton
        projectId={projectId}
        workspaceKey={workspaceKey}
        kind={hasNextStep ? "next_step" : "kickoff"}
      />
    );
  }

  return (
    <section
      className="ui-card-shell flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      aria-labelledby="project-build-status-title"
    >
      <div className="min-w-0">
        <p className="ui-kicker">{KICKER[sentence.tone]}</p>
        <h2
          id="project-build-status-title"
          className="mt-1 flex items-center gap-2 text-lg font-semibold text-text-primary"
        >
          <span className={`ui-dot ${tone}`} aria-hidden="true" />
          {headline}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">
          {detail}
          {look && (
            <>
              {" "}
              <a href={look.href} target="_blank" rel="noreferrer" className="ui-link-subtle">
                {look.label}
              </a>
            </>
          )}
        </p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}
