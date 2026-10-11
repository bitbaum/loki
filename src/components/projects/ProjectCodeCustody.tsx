"use client";

import { useState } from "react";
import { ArrowUpRight, Check, GitBranch, Loader2 } from "lucide-react";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { LinkGithubButton } from "@/components/onboarding/LinkGithubButton";

type HandoverResult = { gitUrl: string; login: string };

/**
 * Who holds this project's code, and the one way to change it.
 *
 * Loki keeps the code so that nobody has to open a GitHub account before an
 * agent writes a line. This says so in plain words — no "repository", no
 * "org" — and offers the way out once there is something worth owning: one
 * tap moves the code to the person's own GitHub, where they manage it from
 * then on. Connecting GitHub is asked for HERE and only here, because it is
 * where the code is going.
 *
 * Rendered in Project settings always (`variant="section"`), and as a short
 * line beside the Live link once the site is up (`variant="line"`) — the
 * moment the suggestion was promised for, and not before.
 */
export function ProjectCodeCustody({
  projectId,
  hasGithub,
  variant = "section",
}: {
  projectId: string;
  /** Whether the person has a GitHub account connected to Loki. */
  hasGithub: boolean;
  variant?: "section" | "line";
}) {
  const [open, setOpen] = useState(variant === "section");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<HandoverResult | null>(null);

  async function handover() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/handover`, {});
      if (!res.ok) await throwApiError(res, "Could not move the code");
      setDone((await res.json()) as HandoverResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the code");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-status-positive">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        On its way to your GitHub as {done.login}. GitHub has sent you an e-mail — accept it there
        and the code is yours to manage from{" "}
        <a href={done.gitUrl} target="_blank" rel="noreferrer" className="underline">
          {done.gitUrl.replace("https://github.com/", "")}
        </a>
        .
      </p>
    );
  }

  const body = (
    <div
      className={variant === "line" ? "mt-2 space-y-2 text-xs text-text-secondary" : "space-y-2"}
    >
      <p className="text-xs leading-relaxed text-text-secondary">
        Loki keeps this project&apos;s code for you, free, so you never had to open an account
        anywhere else. It is yours all the same: move it to your own GitHub and manage it there from
        then on — history and all, nothing copied, nothing left behind.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {hasGithub ? (
          <button
            type="button"
            onClick={handover}
            disabled={busy}
            className="ui-btn-secondary gap-1.5"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <GitBranch className="h-4 w-4" aria-hidden="true" />
            )}
            Move the code to my GitHub
          </button>
        ) : (
          <LinkGithubButton callbackUrl={`/projects/${projectId}`} />
        )}
        {!hasGithub && (
          <span className="text-xs text-text-tertiary">
            GitHub is where the code goes, so this is the one step that needs an account there.
          </span>
        )}
      </div>
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );

  if (variant === "line") {
    return (
      <div className="basis-full">
        <button
          type="button"
          className="ui-btn-ghost min-h-11 gap-1.5"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <GitBranch className="h-4 w-4" aria-hidden="true" />
          Code: kept by Loki
          <span className="text-text-tertiary">· make it yours</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {open && body}
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <p className="ui-micro-label">Who holds the code</p>
      {body}
    </section>
  );
}
