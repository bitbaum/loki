"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, ExternalLink } from "lucide-react";
import type { OrangeCatBuildIntent } from "@/lib/integrations/orangecat-build-intent";
import { decideHandoffMode, interviewAutoHref } from "@/lib/integrations/orangecat-handoff-mode";

interface ProjectOption {
  id: string;
  name: string;
  lokiPath: string;
  repoUrl: string | null;
  dirPath: string | null;
  liveUrl: string | null;
  /** Already the origin of a different OrangeCat entity — relinking repoints it. */
  linkedTo: { title: string | null; publicUrl: string } | null;
  /** Already linked to this same entity — confirming changes nothing. */
  alreadyLinked: boolean;
}

export function OrangeCatBuildHandoff({
  token,
  intent,
  projects,
  review,
}: {
  token: string;
  intent: OrangeCatBuildIntent;
  projects: ProjectOption[];
  /** `?review=1`: the operator wants to choose where this lands before anything starts. */
  review: boolean;
}) {
  // If a project with the exact same name already exists, default to linking
  // it instead of "new" — the whole point of offering a picker is defeated if
  // the obvious match still requires the user to notice and switch the radio
  // themselves. "Bitbaum" on OrangeCat and "Bitbaum" on Loki are almost
  // certainly the same thing; proposing a second "Bitbaum" project by default
  // is exactly the duplicate this picker exists to prevent.
  const exactMatch = projects.find(
    (project) => project.name.trim().toLowerCase() === intent.entity.title.trim().toLowerCase(),
  );
  const connected = projects.find((project) => project.alreadyLinked) ?? null;

  const [mode, setMode] = useState<"new" | "existing">(exactMatch ? "existing" : "new");
  const [projectId, setProjectId] = useState(exactMatch?.id ?? projects[0]?.id ?? "");
  const [showPicker, setShowPicker] = useState(!exactMatch);
  const [replaceOrigin, setReplaceOrigin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Build by default. A failed auto-create degrades to the picker with the
  // error shown, so the operator can finish by hand instead of hitting a wall.
  const [autoFailed, setAutoFailed] = useState(false);
  const handoffMode = decideHandoffMode({
    review,
    connected: Boolean(connected),
    exactMatch: Boolean(exactMatch),
  });
  const autoBuilding = handoffMode === "auto" && !autoFailed;
  const reviewHref = `/integrations/orangecat/build?intent=${encodeURIComponent(token)}&review=1`;

  const selected = projects.find((project) => project.id === projectId) ?? null;
  // Only blocks when the chosen project is the origin of a *different* entity;
  // the server enforces the same rule, so a stale page cannot slip past it.
  const needsReplaceAck = mode === "existing" && Boolean(selected?.linkedTo) && !replaceOrigin;

  async function confirm() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/orangecat/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          projectId: mode === "existing" ? projectId : null,
          replaceExistingOrigin: mode === "existing" && replaceOrigin,
        }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Could not create project.");
      // A new project lands on the interview, which runs the kickoff once it
      // has answers; a linked existing one lands as it is — linking is not
      // consent to start work on it.
      window.location.assign(mode === "new" ? interviewAutoHref(body.url) : body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create project.");
      setSubmitting(false);
      setAutoFailed(true);
    }
  }

  // The one click: consume the intent as soon as the page is up. The ref makes
  // this fire once — the intent is single-use, and React may run effects twice.
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoBuilding || autoFired.current) return;
    autoFired.current = true;
    void confirm();
    // confirm() closes over state that is stable for the life of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuilding]);

  return (
    <>
      {/*
        Say what this page IS before asking anything of the reader. They arrive
        from a button on another product, and the page opened by naming a
        project and demanding a choice — so someone who has not been told how
        OrangeCat and Loki relate has no way to answer it.
      */}
      <header className="mb-8">
        <div className="ui-public-eyebrow">OrangeCat → Loki</div>
        <h1 className="ui-public-page-title mt-3">Bring “{intent.entity.title}” into Loki</h1>
        <p className="ui-public-lede mt-4 max-w-2xl">
          You came from a “Build it with Loki” button on OrangeCat. OrangeCat is where a project is
          made public, financed, and — in its Studio — where video, music, writing and artwork get
          made; Loki is where software gets built. This link carries the title and description
          across so you do not retype them.
        </p>
        <ul className="mt-5 space-y-2 text-sm text-text-secondary">
          {autoBuilding ? (
            <li className="flex gap-2.5">
              <span aria-hidden>—</span>
              <span>
                <strong className="font-medium text-text-primary">
                  Loki asks you a few questions, then builds.
                </strong>{" "}
                It creates the project, asks what your public page could not say, and then fills the
                profile, plans milestones, creates a repository and puts an agent on it. You can
                skip every question. No money moves and nothing is published.{" "}
                <a href={reviewHref} className="ui-public-link">
                  Prefer to choose where it lands first?
                </a>
              </span>
            </li>
          ) : (
            <>
              <li className="flex gap-2.5">
                <span aria-hidden>—</span>
                <span>
                  <strong className="font-medium text-text-primary">Nothing starts running.</strong>{" "}
                  No agent is dispatched, no money moves, and nothing is published.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden>—</span>
                <span>
                  <strong className="font-medium text-text-primary">
                    You choose where it lands
                  </strong>{" "}
                  — a new Loki project, or one you already have.
                </span>
              </li>
            </>
          )}
          <li className="flex gap-2.5">
            <span aria-hidden>—</span>
            <span>
              <strong className="font-medium text-text-primary">
                The link is signed by OrangeCat
              </strong>
              , can be used once, and expires ten minutes after it was created. If it expires, click
              the button on OrangeCat again.
            </span>
          </li>
        </ul>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="min-w-0 rounded-2xl border border-border-subtle bg-surface-base p-6">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-accent-text" aria-hidden />
            <span className="ui-public-eyebrow">What comes across</span>
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-text-primary">{intent.entity.title}</h2>
          {intent.entity.description && (
            <p className="mt-4 whitespace-pre-wrap text-text-secondary">
              {intent.entity.description}
            </p>
          )}
          <a
            href={intent.entity.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-public-link mt-5 inline-flex items-center gap-1.5"
          >
            View the OrangeCat page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>

          <div className="mt-8 border-t border-border-subtle pt-6">
            <h2 className="font-medium text-text-primary">Loki’s proposed starting plan</h2>
            <ol className="mt-4 space-y-3">
              {intent.suggestedHandoff.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                  <span className="font-mono text-text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-xs text-text-muted">
              This creates context and a proposed plan. It does not dispatch agents or make
              real-world commitments.
            </p>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-border-subtle bg-surface-base p-6">
          {connected ? (
            // Nothing to decide. Asking "where should this live?" of a project
            // that already lives somewhere is a question with one answer, and
            // making the reader pick it again is what made this page confusing.
            <>
              <h2 className="text-lg font-semibold text-text-primary">Already connected</h2>
              <p className="mt-2 text-sm text-text-secondary">
                “{intent.entity.title}” on OrangeCat is already connected to a Loki project. There
                is nothing to set up — this is what it is connected to.
              </p>
              <ProjectConnections project={connected} orangeCatUrl={intent.entity.publicUrl} />
              <a href={connected.lokiPath} className="ui-btn-primary mt-6 w-full min-h-11 gap-2">
                Open “{connected.name}” in Loki
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </>
          ) : autoBuilding ? (
            <>
              <h2 className="text-lg font-semibold text-text-primary">Creating the project</h2>
              <p className="mt-2 text-sm text-text-secondary">
                One moment — you will land on the new project with the first question ready.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-text-primary">Where should this live?</h2>
              <p className="mt-2 text-sm text-text-secondary">
                In a <strong className="font-medium text-text-primary">Loki project</strong> — the
                workspace that briefs, tasks and agents hang off. It is not a code repository, but
                it can point at one, at a folder on your machine, and at a live site.
              </p>

              <div className="mt-5 space-y-3">
                {exactMatch && (
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-border-subtle p-4">
                    <input
                      type="radio"
                      checked={mode === "existing"}
                      onChange={() => setMode("existing")}
                      className="mt-1 self-start"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-text-primary">
                        Connect to “{exactMatch.name}”
                        <span className="ui-tag-positive">same name</span>
                      </span>
                      {selected && <ProjectConnections project={selected} compact />}
                      <button
                        type="button"
                        onClick={() => setShowPicker((open) => !open)}
                        className="ui-btn-xs mt-3 min-h-11"
                      >
                        {showPicker ? "Hide other projects" : "Choose a different project"}
                      </button>
                    </span>
                  </label>
                )}

                {(showPicker || !exactMatch) && projects.length > 0 && (
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-border-subtle p-4">
                    <input
                      type="radio"
                      checked={mode === "existing"}
                      onChange={() => setMode("existing")}
                      className="mt-1 self-start"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-text-primary">
                        {exactMatch
                          ? "Connect to another project"
                          : "Connect to an existing project"}
                      </span>
                      <select
                        value={projectId}
                        onChange={(event) => {
                          setProjectId(event.target.value);
                          setReplaceOrigin(false);
                        }}
                        disabled={mode !== "existing"}
                        // min-w-0: a select's intrinsic width is its widest
                        // OPTION, and w-full does not override that — long project
                        // names pushed the whole page past 320px.
                        className="ui-input mt-3 w-full min-w-0"
                      >
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                            {project.linkedTo ? " — connected to another OrangeCat page" : ""}
                          </option>
                        ))}
                      </select>
                      {!exactMatch && selected && <ProjectConnections project={selected} compact />}
                    </span>
                  </label>
                )}

                <label className="flex cursor-pointer gap-3 rounded-xl border border-border-subtle p-4">
                  <input
                    type="radio"
                    checked={mode === "new"}
                    onChange={() => setMode("new")}
                    className="mt-1 self-start"
                  />
                  <span>
                    <span className="block font-medium text-text-primary">
                      Create a new project
                    </span>
                    <span className="mt-1 block text-sm text-text-secondary">
                      Starts with the title, brief, OrangeCat origin and Loki’s plan. No code
                      repository and no folder on your machine are attached — you connect those on
                      the project page afterwards.
                    </span>
                  </span>
                </label>
              </div>

              {mode === "existing" && selected?.linkedTo && (
                <label className="ui-callout-warning mt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replaceOrigin}
                    onChange={(event) => setReplaceOrigin(event.target.checked)}
                    className="mt-1 self-start"
                  />
                  <span className="text-text-secondary">
                    <span className="flex items-center gap-1.5 font-medium text-text-primary">
                      <AlertTriangle className="h-4 w-4" aria-hidden />“{selected.name}” is
                      connected to another OrangeCat page
                    </span>
                    <span className="mt-1 block">
                      It currently points at{" "}
                      <a
                        href={selected.linkedTo.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ui-public-link"
                      >
                        {selected.linkedTo.title ?? "another OrangeCat page"}
                      </a>
                      . Confirming repoints it — and the funding it reads — at {intent.entity.title}
                      . Tick to replace.
                    </span>
                  </span>
                </label>
              )}

              <button
                type="button"
                onClick={confirm}
                disabled={submitting || (mode === "existing" && (!projectId || needsReplaceAck))}
                className="ui-btn-primary mt-6 w-full min-h-11 gap-2"
              >
                {submitting ? "Connecting…" : "Confirm and open project"}
                {!submitting && <ArrowRight className="h-4 w-4" aria-hidden />}
              </button>
              {error && <p className="mt-3 text-sm text-status-negative">{error}</p>}
            </>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * What a project is actually wired to, as links you can follow and check.
 *
 * The first version of this page named a project and stopped, so every option
 * read like a repository and none of them was one. Naming the absence in prose
 * ("no repo, no local checkout") was barely better: a reader who does not
 * already know what a Loki project IS cannot verify a sentence. A row per
 * connection — followed where it exists, explicitly empty where it does not,
 * with somewhere to go and fix it — is checkable without that knowledge.
 *
 * Adding a product later (Solon governance profiles are planned) is one entry.
 */
function ProjectConnections({
  project,
  orangeCatUrl,
  compact = false,
}: {
  project: ProjectOption;
  orangeCatUrl?: string;
  compact?: boolean;
}) {
  // Each link gets the name a person would use for it, not its URL. This card
  // is narrow, and a raw URL truncates to "github.com/bl…" / "www.orangecat.ch
  // /pro…" — which identifies nothing, so the reader is back to guessing.
  const rows: Array<{ label: string; href?: string; text?: string; missing?: string }> = [
    ...(orangeCatUrl
      ? [{ label: "OrangeCat page", href: orangeCatUrl, text: `${project.name} on OrangeCat` }]
      : []),
    { label: "Loki project", href: project.lokiPath, text: project.name },
    {
      label: "Code repository",
      href: project.repoUrl ?? undefined,
      text: project.repoUrl ? repoSlug(project.repoUrl) : undefined,
      missing: "No repository connected",
    },
    {
      label: "Folder on your machine",
      text: project.dirPath ?? undefined,
      missing: "Not set (cloud only)",
    },
    {
      label: "Live website",
      href: project.liveUrl ?? undefined,
      text: project.liveUrl ? hostOf(project.liveUrl) : undefined,
      missing: "Not deployed",
    },
  ];

  return (
    <dl className={`${compact ? "mt-3" : "mt-5"} space-y-2 text-sm`}>
      {rows.map((row) => (
        // Label above the value on a phone, beside it from sm up. A fixed label
        // column plus a full URL overflows 320px, and this page is reached from
        // a link someone taps on their phone.
        <div
          key={row.label}
          className="flex flex-col gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3"
        >
          <dt className="shrink-0 text-text-muted sm:w-32">{row.label}</dt>
          <dd className="w-full min-w-0 sm:flex-1">
            {row.href ? (
              <a
                href={row.href}
                target={row.href.startsWith("/") ? undefined : "_blank"}
                rel={row.href.startsWith("/") ? undefined : "noreferrer"}
                className="ui-public-link inline-flex min-w-0 max-w-full items-center gap-1.5"
              >
                <span className="min-w-0 truncate">{row.text ?? row.href}</span>
                {!row.href.startsWith("/") && (
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                )}
              </a>
            ) : row.text ? (
              <span className="block truncate font-mono text-xs text-text-secondary">
                {row.text}
              </span>
            ) : (
              <span className="text-text-muted">
                {row.missing}
                {" — "}
                <a href={project.lokiPath} className="ui-public-link">
                  add it
                </a>
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "bitbaum/petvity" — the name people actually call a repository by. */
function repoSlug(href: string): string {
  try {
    const parts = new URL(href).pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join("/") : (parts.at(-1) ?? href);
  } catch {
    return href;
  }
}

/** Bare hostname — a site is recognised by its domain, not its full URL. */
function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}
