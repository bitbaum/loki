"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, MessageSquare, SlidersHorizontal, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLEET_SURFACES } from "@/config/navigation";
import { fleetSurfaceHref, type FleetWorkspaceSurfaceId } from "@/lib/fleet-context";
import { useFleetProject } from "@/hooks/use-fleet-project";

const ICONS = {
  profile: FolderKanban,
  chat: MessageSquare,
  control: SlidersHorizontal,
  terminal: SquareTerminal,
} satisfies Record<FleetWorkspaceSurfaceId, typeof MessageSquare>;

/**
 * Profile, Chat, Control, and Terminal are views of one project workspace.
 * Moving between them preserves the active project.
 */
export function FleetSurfaceGuide() {
  const pathname = usePathname();
  const isProjectProfile = pathname.startsWith("/projects/");
  const currentIndex = FLEET_SURFACES.findIndex((s) =>
    s.id === "profile"
      ? isProjectProfile
      : pathname === s.href || pathname.startsWith(`${s.href}/`),
  );
  const project = useFleetProject();

  // Loki is the start/continue surface, not a project-workspace tab. The
  // Profile/Chat/Control/Terminal strip duplicates the bottom nav on phones
  // and answers a question the composer already answers.
  if (pathname === "/loki" || currentIndex === -1) return null;

  // No project, no strip.
  //
  // This component's entire claim is that the four tabs are views of ONE
  // project and moving between them preserves it. With no active project
  // `fleetSurfaceHref` falls back to the bare routes — /projects, /loki,
  // /control, /terminal — which are four sidebar entries rendered a second
  // time, above every Control, Terminal and Projects page, preserving
  // nothing. A navigation surface that carries no information the sidebar
  // lacks is not a shortcut; it is a fifth nav system charging rent.
  if (!project) return null;

  // On a phone, /terminal's own one-line header already names the session and
  // the project; the strip above it was a second and third row of chrome
  // before the conversation, and repeated the project name a line below.
  const phoneHidden = pathname === "/terminal" || pathname.startsWith("/terminal/");

  return (
    <nav
      aria-label="Project workspace views"
      className={cn(
        phoneHidden && "max-md:hidden",
        "mx-3 mt-2 flex max-w-6xl shrink-0 flex-wrap items-center gap-x-2 gap-y-1 sm:mx-4 xl:mx-auto xl:w-full",
      )}
    >
      {/* Wraps instead of clipping: at 320px the four tabs fill the row and
          `overflow-hidden` cut the project name to "Bitbau" — the one word
          that says which project these four views are of. */}
      <div className="inline-flex max-w-full items-center overflow-x-auto rounded-lg border border-border-subtle bg-surface-base p-1">
        {FLEET_SURFACES.map((s, i) => {
          const active = i === currentIndex;
          const Icon = ICONS[s.id];
          return (
            <Link
              key={s.href}
              href={fleetSurfaceHref(s.id, project)}
              className={cn(
                "ui-tap inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors sm:px-3",
                active
                  ? "bg-surface-raised text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-3.5 w-3.5 max-[350px]:hidden" aria-hidden="true" />
              {s.label}
            </Link>
          );
        })}
      </div>
      {project && (
        <span className="min-w-0 max-w-full truncate text-xs text-text-tertiary" title={project}>
          {project}
        </span>
      )}
    </nav>
  );
}
