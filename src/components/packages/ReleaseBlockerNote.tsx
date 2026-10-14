import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import {
  RELEASE_MESSAGES,
  RELEASE_TEMPLATE_URL,
  TEMPLATE_SYNC_URL,
} from "@/config/package-releases";
import type { ReleaseState } from "@/lib/packages/release";

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="ui-link-subtle inline-flex min-h-11 items-center gap-1"
    >
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

/**
 * Why the release button cannot be pressed now, and the way forward on the
 * same screen — never a bare "no". A repository without release.yml gets the
 * fleet's pull request that adds it when there is one, else the two ways to
 * add it.
 */
export function ReleaseBlockerNote({
  blocker,
  release,
}: {
  blocker: string;
  release: ReleaseState;
}) {
  const repoUrl = `https://github.com/${release.repo}`;
  let ways: ReactNode = null;
  if (blocker === RELEASE_MESSAGES.noWorkflow) {
    ways = release.syncPull ? (
      <>
        <span>
          The fleet opened a pull request that adds it; it merges itself when its checks pass.
        </span>
        <Out href={release.syncPull.url}>Pull request #{release.syncPull.number}</Out>
      </>
    ) : (
      <>
        <span>
          The fleet offers it to every package repository it declares, daily. A repository it does
          not declare takes the file by hand.
        </span>
        <Out href={TEMPLATE_SYNC_URL}>Run the fleet&apos;s template sync</Out>
        <Out href={RELEASE_TEMPLATE_URL}>The release.yml to add</Out>
      </>
    );
  } else if (
    blocker === RELEASE_MESSAGES.mainRed ||
    blocker === RELEASE_MESSAGES.mainRunning ||
    blocker === RELEASE_MESSAGES.mainUnknown
  ) {
    ways = <Out href={`${repoUrl}/commits/${release.defaultBranch}`}>See main&apos;s checks</Out>;
  } else if (blocker === RELEASE_MESSAGES.noTag) {
    ways = <Out href={`${repoUrl}/releases/new`}>Tag a release on GitHub</Out>;
  } else if (blocker === RELEASE_MESSAGES.running && release.lastRun) {
    ways = <Out href={release.lastRun.url}>See it run</Out>;
  }
  const quiet = blocker === RELEASE_MESSAGES.nothingToRelease;
  return (
    <div className={quiet ? "text-sm text-text-tertiary" : "ui-callout-warning flex-col gap-1"}>
      <p>{blocker}</p>
      {ways && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0 text-xs text-text-secondary">
          {ways}
        </p>
      )}
    </div>
  );
}
