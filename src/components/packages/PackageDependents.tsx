import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { timeAgo } from "@/lib/dates";
import type { DependentRow } from "@/lib/packages/view";
import { OpenUpdateLine } from "./OpenUpdateLine";
import { PackageStatusTag } from "./PackageStatusTag";
import { projectTitle } from "@/lib/project-display";

/**
 * Which of the person's projects use one package, and at what version —
 * behind first, because that is the row someone opens this page to find —
 * and, where Dependabot has an update open, where that update stands.
 */
export function PackageDependents({
  rows,
  install,
}: {
  rows: DependentRow[];
  /** Shown when nobody uses it yet, so the empty state says how to start. */
  install: string | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState icon={FolderKanban} title="None of your projects uses it yet" size="sm">
        {install ? (
          <>
            Add it to a project with <code className="ui-code-inline">{install}</code>, and it shows
            up here on the next read.
          </>
        ) : (
          "When a project adds it, it shows up here on the next read."
        )}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      <div className="ui-section-label hidden px-4 sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_12rem_6rem] sm:gap-4">
        <span>Project</span>
        <span>Version</span>
        <span>Status</span>
        <span className="text-right">Read</span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.projectId}
            className="ui-list-row flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_12rem_6rem] sm:items-center sm:gap-4"
          >
            <div className="min-w-0">
              <Link
                href={row.href}
                className="wrap-anywhere font-medium text-text-primary hover:underline"
              >
                {projectTitle({ name: row.projectName })}
              </Link>
              <span className="block truncate font-mono text-xs text-text-muted" title={row.spec}>
                {row.spec}
              </span>
              {row.update && (
                <div className="mt-1.5">
                  <OpenUpdateLine update={row.update} />
                </div>
              )}
            </div>
            <span className="font-mono text-sm text-text-secondary">
              {row.version ? `v${row.version}` : "—"}
            </span>
            <span className="flex">
              <PackageStatusTag status={row.status} />
            </span>
            <span className="text-xs text-text-tertiary sm:text-right">
              {timeAgo(row.observedAt.getTime())}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
