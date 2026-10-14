import Link from "next/link";
import { ExternalLink, PackageX } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { PackageDependents } from "@/components/packages/PackageDependents";
import { PackageRelease } from "@/components/packages/PackageRelease";
import { PackageRollout } from "@/components/packages/PackageRollout";
import { PackagesRefresh } from "@/components/packages/PackagesRefresh";
import { ReadCoverageNote } from "@/components/packages/ReadCoverageNote";
import { requirePageUserId } from "@/lib/session";
import { loadPackageDetail } from "@/lib/packages/load";
import type { LatestVersion } from "@/lib/packages/latest";

export const metadata = { title: "Package" };

const LATEST_FROM: Record<LatestVersion["from"], string> = {
  npm: "from npm",
  github: "the highest release tag on GitHub",
  register: "as fleet last recorded it — npm or GitHub did not answer just now",
  none: "nobody could say just now",
};

/** One shared package: what it is, how to install it, and who is on which version. */
export default async function PackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const userId = await requirePageUserId();
  const { slug } = await params;
  const { catalogue, pkg, latest, dependents, coverage, rollout, owner } = await loadPackageDetail(
    userId,
    slug,
  );
  const back = { href: "/packages", label: "Packages" };

  if (!pkg) {
    return (
      <PageLayout title="Package not listed" back={back}>
        <EmptyState
          icon={PackageX}
          title={`bitbaum/fleet does not list “${slug}”`}
          action={
            <Link href="/packages" className="ui-btn-secondary min-h-11">
              See every package
            </Link>
          }
        >
          It may have been renamed or retired, or not registered yet.
        </EmptyState>
      </PageLayout>
    );
  }

  const count = (kind: string) => dependents.filter((d) => d.status.kind === kind).length;
  const tally = [
    [count("behind"), "behind"],
    [count("latest"), "on the latest"],
    [count("unknown"), "version unknown"],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(", ");
  return (
    <PageLayout
      title={pkg.name}
      // The description says it in full in the card below; the summary is
      // only worth a subtitle when there is nothing longer to read.
      subtitle={pkg.description ? undefined : (pkg.summary ?? undefined)}
      back={back}
      right={<PackagesRefresh autoStart={coverage.stale} />}
    >
      <section className="ui-card-shell ui-card-padding space-y-5" aria-label="About this package">
        {pkg.description && (
          <p className="text-sm leading-relaxed text-text-secondary">{pkg.description}</p>
        )}
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="ui-micro-label">Latest version</dt>
            <dd className="mt-1">
              <span className="font-mono text-lg text-text-primary">
                {latest.version ? `v${latest.version}` : "Unknown"}
              </span>
              <span className="block text-xs text-text-tertiary">{LATEST_FROM[latest.from]}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="ui-micro-label">Install</dt>
            <dd className="mt-1">
              {pkg.install ? (
                <code className="ui-code-inline inline-block max-w-full wrap-anywhere text-sm">
                  {pkg.install}
                </code>
              ) : (
                <span className="text-sm text-text-tertiary">
                  The register gives no install command.
                </span>
              )}
            </dd>
          </div>
          {pkg.repo && (
            <div className="min-w-0">
              <dt className="ui-micro-label">Repository</dt>
              <dd className="mt-1">
                <a
                  href={`https://github.com/${pkg.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-btn-ghost min-h-11 gap-1.5 px-0"
                >
                  {pkg.repo}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </dd>
            </div>
          )}
          {pkg.adopterNames.length > 0 && (
            <div className="min-w-0">
              <dt className="ui-micro-label">Across the fleet</dt>
              <dd className="mt-1 text-sm text-text-secondary">
                {pkg.adopterNames.length}{" "}
                {pkg.adopterNames.length === 1 ? "repository" : "repositories"} adopted it, by
                fleet&apos;s count
              </dd>
            </div>
          )}
        </dl>
      </section>

      {pkg.repo && <PackageRelease slug={pkg.slug} />}

      <PackageRollout slug={pkg.slug} rows={rollout} owner={owner} />

      <section className="space-y-3" aria-labelledby="package-dependents-title">
        <div>
          <h2 id="package-dependents-title" className="text-lg font-semibold text-text-primary">
            Your projects using it
          </h2>
          <p className="text-xs text-text-tertiary">
            {dependents.length === 0
              ? "None so far."
              : `${dependents.length} ${dependents.length === 1 ? "project" : "projects"}: ${tally}.`}
          </p>
        </div>
        <PackageDependents rows={dependents} install={pkg.install} />
        <ReadCoverageNote coverage={coverage} catalogueSource={catalogue.source} />
      </section>
    </PageLayout>
  );
}
