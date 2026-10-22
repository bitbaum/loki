import Link from "next/link";
import { Package } from "lucide-react";
import { timeAgo } from "@/lib/dates";
import { loadProjectBuiltFrom } from "@/lib/packages/load";
import { PACKAGE_UPDATE_SETTINGS } from "@/config/package-updates";
import { OpenUpdateLine } from "./OpenUpdateLine";
import { PackageStatusTag } from "./PackageStatusTag";
import { PackageUpdateSettingControl } from "./PackageUpdateSettingControl";
import { PackagesRefresh } from "./PackagesRefresh";

/**
 * "Built from": the fleet packages this project's repository depends on, at
 * the version its lockfile resolved, each linking to the package's page where
 * every other project's version sits beside it — with any update Dependabot
 * has open for it, and the project's choice of how updates arrive.
 */
export async function ProjectBuiltFrom({
  userProjectId,
  hasRepo,
  readonly,
}: {
  userProjectId: string | null;
  hasRepo: boolean;
  readonly: boolean;
}) {
  const data = userProjectId ? await loadProjectBuiltFrom(userProjectId).catch(() => null) : null;
  const scan = data?.scan ?? null;
  const rows = data?.rows ?? [];

  let empty: React.ReactNode = null;
  if (!hasRepo || !userProjectId) {
    empty = (
      <>
        Loki reads this from the project&apos;s repository, and it has none yet.{" "}
        <Link href="/packages" className="ui-link-subtle">
          See the fleet&apos;s packages
        </Link>
      </>
    );
  } else if (!scan) {
    empty = "Not read yet.";
  } else if (scan.outcome === "unreachable" || scan.outcome === "error") {
    empty = scan.detail ?? "The repository could not be read.";
  } else if (rows.length === 0) {
    empty = (
      <>
        {scan.outcome === "no-manifest"
          ? "The repository has no package.json, so it uses no shared package."
          : "It uses none of the fleet's shared packages."}{" "}
        <Link href="/packages" className="ui-link-subtle">
          See what the fleet shares
        </Link>
      </>
    );
  }

  return (
    <section className="ui-project-section" aria-labelledby="project-built-from-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="project-built-from-title" className="ui-project-section-title">
            Built from
          </h2>
          <p className="text-xs text-text-tertiary">
            Shared fleet packages in its repository
            {scan ? ` · read ${timeAgo(scan.scannedAt.getTime())}` : ""}
          </p>
        </div>
        {!readonly && hasRepo && userProjectId && (
          <PackagesRefresh
            projectId={userProjectId}
            autoStart={!scan}
            label={scan ? "Read again" : "Read it now"}
          />
        )}
      </div>
      {empty ? (
        <p className="text-sm text-text-secondary">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const inner = (
              <>
                <Package className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                <span className="min-w-0 flex-1 wrap-anywhere font-medium text-text-primary">
                  {row.packageName}
                </span>
                <span className="font-mono text-xs text-text-secondary">
                  {row.version ? `v${row.version}` : row.spec}
                </span>
                <PackageStatusTag status={row.status} />
              </>
            );
            return (
              <li key={row.packageName} className="space-y-1.5">
                {row.slug ? (
                  <Link
                    href={`/packages/${row.slug}`}
                    className="ui-list-row ui-row-interactive flex flex-wrap items-center gap-x-3 gap-y-1.5"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="ui-list-row flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {inner}
                  </div>
                )}
                {row.update && (
                  <div className="pl-4 sm:pl-11">
                    <OpenUpdateLine update={row.update} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasRepo && userProjectId && data && (
        <div className="mt-5 border-t border-border-subtle pt-4">
          {readonly ? (
            <p className="text-sm text-text-secondary">
              <span className="ui-micro-label mr-2">Updates</span>
              {PACKAGE_UPDATE_SETTINGS.find((s) => s.id === data.setting)?.consequence}
            </p>
          ) : (
            <PackageUpdateSettingControl projectId={userProjectId} initial={data.setting} />
          )}
        </div>
      )}
    </section>
  );
}
