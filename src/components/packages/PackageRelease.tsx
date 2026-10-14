"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Rocket } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { postJson } from "@/lib/api/fetch";
import { BUMP_WORDS } from "@/config/package-releases";
import { LinkGithubButton } from "@/components/onboarding/LinkGithubButton";
import type { ReleasePanelData } from "@/lib/packages/release";
import { ReleaseBlockerNote } from "./ReleaseBlockerNote";
import { ReleaseChanges, ReleaseRunLine } from "./ReleaseChanges";

/** While a release runs, the panel reads GitHub again this often. */
const RUNNING_POLL_MS = 20_000;

/**
 * "Unreleased" on a package's page: the changes since the last release, the
 * version they make, and — for the package's owner — "Release vX.Y.Z", which
 * starts the package repository's own release.yml. Everyone else sees why
 * they cannot, with the way forward when there is one.
 *
 * Read from GitHub when the page opens (GET /api/packages/[slug]/release), so
 * the page itself never waits on it.
 */
export function PackageRelease({ slug }: { slug: string }) {
  const [running, setRunning] = useState(false);
  const { data, loading, error, refetch } = useFetch<ReleasePanelData>(
    `/api/packages/${slug}/release`,
    { intervalMs: running ? RUNNING_POLL_MS : undefined, timeoutMs: 30_000 },
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  /** The version just started, until GitHub lists its run (a dispatch takes a few seconds to appear). */
  const [awaiting, setAwaiting] = useState<string | null>(null);

  const release = data && data.access.ok && "release" in data ? data.release : null;
  // Poll while a release runs: derived from the last answer, adjusted during
  // render (React's pattern for state that follows a prop) rather than in an effect.
  const shouldPoll =
    release?.lastRun?.phase === "running" ||
    (awaiting !== null && release?.lastRun?.version !== awaiting);
  if (data && !loading && shouldPoll !== running) setRunning(shouldPoll);

  async function start() {
    if (!release?.suggestion) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await postJson(`/api/packages/${slug}/release`, {
        version: release.suggestion.version,
        bump: release.suggestion.bump,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not start the release just now.");
      setResult({ text: body.message ?? "Release started.", error: false });
      setAwaiting(release.suggestion.version);
      setRunning(true);
      refetch();
    } catch (err) {
      setResult({
        text: err instanceof Error ? err.message : "Could not start the release just now.",
        error: true,
      });
      refetch();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  let body: ReactNode;
  if (!data && loading) {
    body = (
      <p className="text-sm text-text-tertiary">Reading what changed since the last release…</p>
    );
  } else if (!data) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="ui-error-xs">{error ?? "Could not read the package's repository."}</p>
        <button type="button" onClick={refetch} className="ui-btn-secondary min-h-11">
          Try again
        </button>
      </div>
    );
  } else if (!data.access.ok) {
    body = (
      <div className="space-y-2">
        <p className="text-sm text-text-tertiary">{data.access.reason}</p>
        {data.access.connectGithub && (
          <LinkGithubButton callbackUrl={`/packages/${slug}`} size="sm" />
        )}
      </div>
    );
  } else if (release) {
    const s = release.suggestion;
    const blocker = "blocker" in data ? data.blocker : null;
    const total = release.unreleased?.total ?? 0;
    body = (
      <div className="space-y-4">
        {release.lastRun && <ReleaseRunLine run={release.lastRun} />}
        {total > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">
              {total} {total === 1 ? "change" : "changes"} since v{release.current}
            </p>
            <ReleaseChanges release={release} />
          </div>
        )}
        {s && (
          <p className="text-sm text-text-secondary">
            Next version: <span className="font-mono text-text-primary">v{s.version}</span> —{" "}
            {BUMP_WORDS[s.bump]}.{" "}
            {s.breaking
              ? "Every project will be asked before taking it."
              : "Projects on Automatic take it once their tests pass."}
          </p>
        )}
        {blocker ? (
          <ReleaseBlockerNote blocker={blocker} release={release} />
        ) : (
          s && (
            <div className="flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <button
                    type="button"
                    onClick={() => void start()}
                    disabled={busy}
                    className="ui-btn-primary min-h-11 gap-2"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Yes, release v{s.version}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="ui-btn-secondary min-h-11"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="ui-btn-primary min-h-11 gap-2"
                >
                  <Rocket className="h-4 w-4" aria-hidden />
                  Release v{s.version}
                </button>
              )}
            </div>
          )
        )}
      </div>
    );
  }

  return (
    <section
      className="ui-card-shell ui-card-padding space-y-3"
      aria-labelledby="package-release-title"
    >
      <h2 id="package-release-title" className="text-lg font-semibold text-text-primary">
        Unreleased
      </h2>
      {body}
      {result && (
        <p
          role={result.error ? "alert" : "status"}
          className={result.error ? "ui-error-xs" : "text-xs text-text-tertiary"}
        >
          {result.text}
        </p>
      )}
    </section>
  );
}
