import Link from "next/link";
import { MessageSquare, Users } from "lucide-react";
import { ROLE_LABELS, askPath } from "@/lib/project-capabilities";
import type { SharedProject } from "@/db/queries/project-access";

/**
 * The projects someone else shared with you, each with the one thing you do
 * there: ask for a change. Today and Control show it in place of "Add a
 * project" and "Connect a builder", which is what a Builder who owns nothing
 * was told on both — the second with a desktop app to install (walk as Manu,
 * 2026-10-18). The project they were invited to IS their way in.
 */
export function SharedProjectsCard({ projects }: { projects: readonly SharedProject[] }) {
  if (projects.length === 0) return null;
  return (
    <section className="ui-callout-accent" aria-labelledby="shared-projects-title">
      <Users className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-3">
        <p id="shared-projects-title" className="font-medium text-text-primary">
          {projects.length === 1 ? "Shared with you" : `Shared with you · ${projects.length}`}
        </p>
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.projectId} className="min-w-0">
              <p className="truncate text-base text-text-primary">{p.name}</p>
              <p className="text-sm text-text-secondary">
                {p.ownerName?.trim() || "Its owner"} added you as {ROLE_LABELS[p.role].label}
              </p>
              <Link href={askPath(p.projectId)} className="ui-btn-primary mt-2 min-h-11 gap-2">
                <MessageSquare className="h-4 w-4" aria-hidden="true" /> Ask for a change
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
