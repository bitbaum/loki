"use client";

import { useState } from "react";
import Link from "next/link";
import { X, Radio, WifiOff, Sparkles, Download, Terminal, Cpu, Loader2 } from "lucide-react";
import { timeAgo } from "@/lib/dates";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { APP_URL } from "@/config/brand";
import { postJson } from "@/lib/api/fetch";
import "@/components/desktop/types"; // declare global window.fleetRunner
import { useInsideFleetRunner } from "@/hooks/use-inside-fleet-runner";

type Props = {
  runnerNeverSeen: boolean;
  runnerOffline: boolean;
  runnerLastPushedAt: string | null;
  /** True on local installs only. Cloud renders runner controls disabled. */
  runtimeAvailable?: boolean;
  /** When true, the user already has at least one project. Drop the
   *  "Start a new project" pitch from the never-seen variant — they
   *  already have one; they need Fleet Runner. */
  hasProjects?: boolean;
  /** Caller refreshes its data view after the Fleet Runner connection changes. */
  onRefresh?: () => void;
};

export function RunnerStatusBanner({
  runnerNeverSeen,
  runnerOffline,
  runnerLastPushedAt,
  runtimeAvailable = false,
  hasProjects = false,
  onRefresh,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  // Detect Fleet Runner so we can short-circuit the "Install Fleet Runner"
  // CTA and replace it with a one-click "Pair this app" button when the
  // user is already running inside the desktop shell. (SSOT hook.)
  const insideFleetRunner = useInsideFleetRunner();
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairedTokenLabel, setPairedTokenLabel] = useState<string | null>(null);

  /** Mint a fresh agent token + hand it to the in-app Fleet Runner over IPC.
   *  One click instead of: open /settings, fill label, click "Open in Fleet
   *  Runner" deep-link. Only meaningful when running inside the desktop app. */
  async function pairInAppFleetRunner() {
    const save = window.fleetRunner?.saveToken;
    if (!save) {
      setPairError("This Fleet Runner build is missing the saveToken IPC — please update.");
      return;
    }
    setPairing(true);
    setPairError(null);
    try {
      const res = await postJson("/api/agent-tokens", {
        label: `Fleet Runner · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        token?: string;
        label?: string;
      };
      if (!res.ok || !body.token) {
        setPairError(body.error ?? `Failed to mint token (HTTP ${res.status})`);
        return;
      }
      const saveRes = await save(body.token);
      if (!saveRes?.ok) {
        setPairError(saveRes?.error ?? "Token minted but Fleet Runner refused to save it");
        return;
      }
      setPairedTokenLabel(body.label ?? "Fleet Runner token");
      // Trigger a /api/onboarding re-probe so the banner can hide on next render.
      onRefresh?.();
    } catch (e) {
      setPairError(e instanceof Error ? e.message : "Pairing failed");
    } finally {
      setPairing(false);
    }
  }

  // Progressive disclosure: the offline variant starts as a one-line status
  // chip — "offline, commands queue" is all most visits need. The full
  // recovery guidance expands on demand. The never-seen (setup) variant
  // stays expanded: that's onboarding, not noise.
  const [expanded, setExpanded] = useState(false);

  if (dismissed || (!runnerNeverSeen && !runnerOffline)) return null;

  const lastSeen = runnerLastPushedAt ? timeAgo(new Date(runnerLastPushedAt).getTime()) : null;

  if (!runnerNeverSeen && !expanded) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-raised/60 px-3 py-2 text-xs text-text-tertiary">
        <WifiOff className="h-3.5 w-3.5 shrink-0 text-status-warning" />
        <span className="min-w-0 truncate">{EXECUTOR_COPY.runnerBanner.offlineChip(lastSeen)}</span>
        <button
          onClick={() => setExpanded(true)}
          className="ml-auto shrink-0 text-accent-text hover:underline"
        >
          {EXECUTOR_COPY.runnerBanner.reconnect}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="ui-tap-icon shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="ui-callout-warning">
      <div className="mt-0.5 shrink-0 text-status-warning">
        {runnerNeverSeen ? <Radio className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <span className="font-medium text-text-primary">
            {runnerNeverSeen
              ? EXECUTOR_COPY.runnerBanner.neverSeenTitle
              : EXECUTOR_COPY.runnerBanner.offlineTitle}
          </span>
          {!runnerNeverSeen && lastSeen && (
            <span className="ml-2 text-xs text-text-tertiary">last seen {lastSeen}</span>
          )}
        </div>

        {runnerNeverSeen ? (
          <>
            <p className="text-text-secondary leading-relaxed">
              {hasProjects
                ? "Connect this computer if you want agents to run on your local repos. Control works in the browser either way."
                : EXECUTOR_COPY.runnerBanner.neverSeenBody}
            </p>

            <div className={`grid gap-2 ${hasProjects ? "" : "md:grid-cols-2"}`}>
              {/* Path A — "Start a new project" pitch. Hidden when the user
                  already has projects (the welcome cards on /control's empty
                  state already cover that case; users-with-projects don't
                  need to be told to start one). */}
              {!hasProjects && (
                <Link
                  href="/control/new-from-scratch"
                  className="ui-card-shell hover:border-accent-primary transition-colors p-3 flex flex-col gap-1 group"
                >
                  <div className="flex items-center gap-1.5 font-medium text-text-primary text-sm">
                    <Sparkles className="h-3.5 w-3.5 text-accent-text" />
                    Start a new project
                  </div>
                  <p className="text-xs text-text-muted">
                    Creates a GitHub repo + project record right from this website. No install. Pick
                    a starter (Next.js, FastAPI, Hono, plain HTML), clone wherever.
                  </p>
                  <span className="text-xs text-accent-text mt-auto pt-1 group-hover:underline">
                    No install needed →
                  </span>
                </Link>
              )}

              {/* Path B branches on whether we're already inside Fleet Runner.
                  When yes: replace the "download" CTA with a one-click pair
                  button (the user already has the app, they just need the
                  runner's auth glue to land). When no: keep the download
                  card so new users know to install for local dispatch. */}
              {insideFleetRunner ? (
                pairedTokenLabel ? (
                  <div className="ui-card-shell p-3 flex flex-col gap-1 border-status-positive">
                    <div className="flex items-center gap-1.5 font-medium text-status-positive text-sm">
                      <Cpu className="h-3.5 w-3.5" />
                      Paired with this computer
                    </div>
                    <p className="text-xs text-text-muted">
                      Token <strong>{pairedTokenLabel}</strong> saved.{" "}
                      {EXECUTOR_COPY.builder.online} within ~30s.
                    </p>
                  </div>
                ) : (
                  <div className="ui-card-shell p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 font-medium text-text-primary text-sm">
                      <Cpu className="h-3.5 w-3.5 text-accent-text" />
                      Pair this computer
                    </div>
                    <p className="text-xs text-text-muted">
                      You&apos;re in the desktop app. One click connects it to the shared builder
                      queue. — no manual copy-paste.
                    </p>
                    <button
                      type="button"
                      onClick={pairInAppFleetRunner}
                      disabled={pairing}
                      className="ui-btn-primary self-start gap-1.5 text-xs disabled:opacity-50"
                    >
                      {pairing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Pairing…
                        </>
                      ) : (
                        <>
                          <Cpu className="h-3.5 w-3.5" />
                          Pair now
                        </>
                      )}
                    </button>
                    {pairError && <p className="text-xs text-status-warning">{pairError}</p>}
                  </div>
                )
              ) : (
                <Link
                  href="/download"
                  className="ui-card-shell hover:border-accent-primary transition-colors p-3 flex flex-col gap-1 group"
                >
                  <div className="flex items-center gap-1.5 font-medium text-text-primary text-sm">
                    <Download className="h-3.5 w-3.5 text-accent-text" />
                    Get the desktop app
                  </div>
                  <p className="text-xs text-text-muted">
                    Optional — run agents on this computer with your local folders and CLI tools.
                    Same dashboard as the website.
                  </p>
                  <span className="text-xs text-accent-text mt-auto pt-1 group-hover:underline">
                    Download for your OS →
                  </span>
                </Link>
              )}
            </div>

            <details className="text-xs text-text-tertiary mt-1">
              <summary className="cursor-pointer hover:text-text-secondary">
                <Terminal className="inline h-3 w-3 mr-1 -mt-0.5" />
                Prefer a terminal-only install? (CLI agent installer)
              </summary>
              <div className="mt-2 ml-4 space-y-1.5">
                <p>
                  Mint a token at{" "}
                  <Link href="/settings#agent" className="text-accent-text underline">
                    /settings → Agent tokens
                  </Link>{" "}
                  and paste this in a terminal:
                </p>
                <pre className="ui-card-shell p-2 overflow-x-auto text-xs">
                  <code>{`curl -fsSL ${APP_URL}/api/agent/install | node - init --token ck_xxxxxxxx`}</code>
                </pre>
              </div>
            </details>
          </>
        ) : (
          <>
            <p className="text-text-secondary leading-relaxed">
              {EXECUTOR_COPY.runnerBanner.offlineBody}
            </p>
            <p className="text-xs text-text-muted">
              {EXECUTOR_COPY.runnerBanner.reconnectHint}{" "}
              <Link href="/settings#agent" className="text-accent-text underline">
                {EXECUTOR_COPY.runnerBanner.settingsLink}
              </Link>{" "}
              or{" "}
              <Link href="/download" className="text-accent-text underline">
                {EXECUTOR_COPY.runnerBanner.downloadLink}
              </Link>
              .
            </p>
          </>
        )}

        {/* One-click agent CLI install. Suppressed when Fleet Runner is
            offline on a cloud install: the buttons POST to
            /api/agent/install-cli, which queues an installer command for
            Fleet Runner to pick up — with it down the buttons silently no-op,
            contradicting the banner just above. Kept in the never-seen
            (setup) flow and when running locally. Also suppressed inside
            Fleet Runner — MissingCLIsBanner handles that case and only shows
            the CLIs ACTUALLY missing (v0.6.0 getInstalledCLIs IPC). */}
        {(runnerNeverSeen || runtimeAvailable) && !insideFleetRunner && (
          <div className="pt-2 border-t border-border-subtle">
            <p className="text-xs text-text-muted mb-1.5">
              Missing an agent CLI? Click to open a dedicated terminal tab with the installer:
            </p>
            <div className="flex flex-wrap gap-2">
              {["grok", "claude", "cursor", "gemini", "codex"].map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    // Best effort — Fleet Runner opens the tab if connected.
                    postJson("/api/agent/install-cli", { agent: a }).catch(() => {});
                  }}
                  className="ui-btn-secondary ui-btn-xs"
                >
                  Install {a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-micro text-text-muted mt-1">
              When Fleet Runner is running, these buttons open a dedicated “Install X” tab with the
              installer already pasted.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="ui-tap-icon shrink-0 rounded p-1 text-text-muted transition-colors hover:text-text-primary"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
