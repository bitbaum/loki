import { Package } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { PackagesList } from "@/components/packages/PackagesList";
import { PackagesRefresh } from "@/components/packages/PackagesRefresh";
import { ReadCoverageNote } from "@/components/packages/ReadCoverageNote";
import { NpmPublishPanel } from "@/components/packages/NpmPublishPanel";
import { requirePageUserId } from "@/lib/session";
import { loadPackagesOverview } from "@/lib/packages/load";
import { FLEET_REPO } from "@/lib/fleet-brief/brief";

export const metadata = { title: "Packages" };

/**
 * What the fleet is built from: every shared package bitbaum/fleet registers,
 * its latest version, and how many of your projects use it — and how many of
 * those are behind. Read-only; nothing here changes a project.
 */
export default async function PackagesPage() {
  const userId = await requirePageUserId();
  const { catalogue, rows, coverage } = await loadPackagesOverview(userId);
  const registerUrl = `https://github.com/${FLEET_REPO.owner}/${FLEET_REPO.repo}/blob/${FLEET_REPO.branch}/registers/packages.json`;

  return (
    <PageLayout
      title="Packages"
      subtitle="The fleet's shared packages, and which version each of your projects is on."
      right={<PackagesRefresh autoStart={coverage.stale} />}
    >
      <ReadCoverageNote coverage={coverage} catalogueSource={catalogue.source} />
      <NpmPublishPanel />
      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="The fleet register lists no packages"
          action={
            <a
              href={registerUrl}
              target="_blank"
              rel="noreferrer"
              className="ui-btn-secondary min-h-11"
            >
              Open the register
            </a>
          }
        >
          Packages appear here once bitbaum/fleet registers them.
        </EmptyState>
      ) : (
        <PackagesList rows={rows} />
      )}
    </PageLayout>
  );
}
