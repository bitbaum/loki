/**
 * The consent rule (client-work.ts) for public lists read straight from the
 * projects table: /u/<owner>, the /fleet catalogue and the landing showcase.
 * Those lists never pass through the register, so they ask here which hosting
 * row a project has and drop client work the client has not agreed to show.
 */
import type { HostedApp } from "./apps-conf";
import { readAppsConf } from "./apps-conf";
import { canonicalSlug, repoFromGitUrl } from "./build";
import { isClientWork, mayShowPublicly } from "./client-work";

type ProjectFacts = {
  name: string;
  slug?: string | null;
  gitUrl?: string | null;
  hostedApp?: string | null;
  clientWork?: boolean | null;
  portfolioConsentAt?: Date | string | null;
};

/** The hosting row a project is served by: explicit link first, then its canonical name. */
export function hostingRowFor(p: ProjectFacts, apps: readonly HostedApp[]): HostedApp | null {
  if (p.hostedApp) {
    const linked = apps.find((a) => a.name === p.hostedApp);
    if (linked) return linked;
  }
  const slug = canonicalSlug(p.slug || repoFromGitUrl(p.gitUrl) || p.name);
  return apps.find((a) => canonicalSlug(a.name) === slug) ?? null;
}

export function projectIsClientWork(p: ProjectFacts, apps: readonly HostedApp[]): boolean {
  return isClientWork(p.clientWork, hostingRowFor(p, apps));
}

/**
 * Keep what may be shown publicly. `apps` defaults to the register shipped
 * with this build; when that file cannot be read, only a project's own
 * client_work answer can mark it, so set it on client projects explicitly.
 */
export function withoutPrivateClientWork<T extends ProjectFacts>(
  projects: readonly T[],
  apps: readonly HostedApp[] = readAppsConf(),
): T[] {
  return projects.filter((p) =>
    mayShowPublicly(projectIsClientWork(p, apps), p.portfolioConsentAt),
  );
}
