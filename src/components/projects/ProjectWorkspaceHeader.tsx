"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageSquare, Pencil } from "lucide-react";
import { PageAction, PageActionButton } from "@/components/ui/page-action";
import { patchJson } from "@/lib/api/fetch";
import { rememberFleetProject } from "@/lib/fleet-context";
import { trackUsage } from "@/lib/usage/track";
import { ROLE_LABELS } from "@/lib/project-capabilities";
import type { ProjectRole } from "@/db/schema/project-memberships";

/**
 * A project's header: the way back, its name, and its ONE primary action
 * (design reset rules 1, 2 and 5, docs/development/design-reset-2026-10.md).
 *
 * It used to carry a settings gear, a two-line summary and three outlined
 * buttons in a row (Ask Loki · Open site · Invite). Settings and People are
 * sections of this page; "Open the site" is the first row of Overview; the
 * description is the Story. What is left is what a person opens a project
 * to do: ask for something — "Ask Loki", or, on someone else's project,
 * "Ask for a change". It sits where every page's primary action sits: the
 * phone's top bar, the right of this header from md up.
 */
export function ProjectWorkspaceHeader({
  projectId,
  name,
  workspaceKey,
  readonly,
  viewerRole = null,
  quiet = false,
}: {
  projectId: string;
  /** What a person calls it (projectTitle). The owner renames it in place. */
  name: string;
  workspaceKey: string;
  readonly: boolean;
  /** Named on a shared project. "View only" was said to a Builder who had
   *  just joined to fix things (walk-through, 2026-10-17). */
  viewerRole?: "owner" | ProjectRole | null;
  /** The page below already leads with its own primary action (the kickoff's
   *  "Make it happen"), so the header offers none: one primary per screen. */
  quiet?: boolean;
}) {
  useEffect(() => {
    rememberFleetProject(workspaceKey);
    trackUsage({ surface: "projects.workspace", action: "shown", target: "header" });
  }, [workspaceKey]);
  const member = readonly && viewerRole !== null && viewerRole !== "owner";
  // Someone on another person's project asks in the box on this page
  // (MemberGuide → ProjectAskBox). The chat runs in THEIR account, which has
  // no builder for this project: it told a Builder to edit HTML and install
  // the desktop app (walk as Manu, 2026-10-18).
  const ask = member
    ? { href: "#ask", label: "Ask for a change", target: "ask" }
    : {
        href: `/loki?project=${encodeURIComponent(workspaceKey)}`,
        label: "Ask Loki",
        target: "chat",
      };
  return (
    <header className="ui-project-header">
      <Link href="/projects" className="ui-page-back">
        <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Projects
      </Link>
      <div className="ui-project-title-row">
        <div className="min-w-0 flex-1">
          {readonly ? (
            <h1 className="ui-project-title">{name}</h1>
          ) : (
            <ProjectTitle projectId={projectId} name={name} />
          )}
          {readonly && (
            <p className="ui-project-shared">
              Shared with you
              {viewerRole && viewerRole !== "owner" && ` · ${ROLE_LABELS[viewerRole].label}`}
            </p>
          )}
        </div>
        {!quiet && (
          <PageAction>
            <span
              className="contents"
              onClickCapture={() =>
                trackUsage({ surface: "projects.workspace", action: "tap", target: ask.target })
              }
            >
              <PageActionButton label={ask.label} icon={MessageSquare} href={ask.href} />
            </span>
          </PageAction>
        )}
      </div>
    </header>
  );
}

/**
 * The heading, renamed where it stands: a pencil beside it, Enter to keep.
 * The rename was a field in the Story tab, three taps from the name the owner
 * wanted to change (owner, 2026-10-19: "how can I actually change the name
 * here?"). It writes the title, never the key the project's history uses.
 */
function ProjectTitle({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const save = async () => {
    const next = draft?.trim() ?? "";
    if (!next || next === name) return setDraft(null);
    // The title, not the name: the name keys the project's history (activity,
    // runs, jobs), so a rename must never hide its past. A failure keeps the
    // draft in the box.
    const response = await patchJson(`/api/projects/${projectId}`, { title: next }).catch(
      () => null,
    );
    if (!response?.ok) return setError("That name was not saved. Your draft is still here.");
    setDraft(null);
    setError("");
    router.refresh();
  };
  if (draft === null)
    return (
      <div className="flex items-center gap-1">
        <h1 className="ui-project-title min-w-0">{name}</h1>
        <button
          type="button"
          className="ui-topbar-btn shrink-0"
          aria-label="Rename the project"
          onClick={() => setDraft(name)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  return (
    <div className="space-y-2">
      <input
        autoFocus
        aria-label="Project name"
        className="ui-input w-full text-xl"
        maxLength={80}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDraft(null);
          if (event.key === "Enter") void save();
        }}
      />
      <div className="flex gap-2">
        <button type="button" className="ui-btn-save min-h-11" onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="ui-btn-ghost min-h-11" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="ui-error">
          {error}
        </p>
      )}
    </div>
  );
}
