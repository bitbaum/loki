"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, MessageSquare, Pencil, Settings, UserPlus } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import { rememberFleetProject } from "@/lib/fleet-context";
import { summarizeDescription } from "@/lib/project-display";
import { ownerSiteUrl } from "../../../widget/owner-pass";
import { trackUsage } from "@/lib/usage/track";
import { ROLE_LABELS } from "@/lib/project-capabilities";
import type { ProjectRole } from "@/db/schema/project-memberships";

/** Identity and the two everyday actions. Configuration belongs in Settings. */
export function ProjectWorkspaceHeader({
  projectId,
  name,
  workspaceKey,
  description,
  liveUrl,
  ownerPass,
  readonly,
  viewerRole = null,
  quiet = false,
}: {
  projectId: string;
  /** What a person calls it (projectTitle). The owner renames it in place. */
  name: string;
  workspaceKey: string;
  description: string | null;
  liveUrl: string | null;
  ownerPass: string | null;
  readonly: boolean;
  /** Named on a shared project. "View only" was said to a Builder who had
   *  just joined to fix things (walk-through, 2026-10-17). */
  viewerRole?: "owner" | ProjectRole | null;
  /** The page below already leads with its own primary action (the kickoff's
   *  "Make it happen"): Ask Loki steps down to secondary, so the screen has
   *  one orange button, not two a thumb apart (walk-through, 2026-10-17). */
  quiet?: boolean;
}) {
  useEffect(() => {
    rememberFleetProject(workspaceKey);
    trackUsage({ surface: "projects.workspace", action: "shown", target: "header" });
  }, [workspaceKey]);
  const summary = summarizeDescription(description, 145);
  const member = readonly && viewerRole !== null && viewerRole !== "owner";
  const track = (target: string) =>
    trackUsage({ surface: "projects.workspace", action: "tap", target });
  return (
    <header className="ui-project-header">
      <div className="flex items-center justify-between gap-3">
        <Link href="/projects" className="ui-project-back">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Projects
        </Link>
        {!readonly && (
          <a href="#settings" className="ui-btn-icon h-11 w-11" aria-label="Project settings">
            <Settings className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="mt-4 sm:mt-6">
        {readonly ? (
          <h1 className="ui-project-title">{name}</h1>
        ) : (
          <ProjectTitle projectId={projectId} name={name} />
        )}
        {summary && <p className="ui-project-summary">{summary}</p>}
        {readonly && (
          <p className="mt-2 text-sm text-text-tertiary">
            Shared with you
            {viewerRole && viewerRole !== "owner" && ` · ${ROLE_LABELS[viewerRole].label}`}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {/* Someone on another person's project asks in the box on this page
            (MemberGuide → ProjectAskBox). The chat runs in THEIR account,
            which has no builder for this project: it told a Builder to edit
            HTML and install the desktop app (walk as Manu, 2026-10-18). */}
        <Link
          href={member ? "#ask" : `/loki?project=${encodeURIComponent(workspaceKey)}`}
          className={`${quiet ? "ui-btn-secondary" : "ui-btn-primary"} min-h-11 gap-2`}
          onClick={() => track(member ? "ask" : "chat")}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />{" "}
          {member ? "Ask for a change" : "Ask Loki"}
        </Link>
        {liveUrl && (
          <a
            href={ownerPass ? ownerSiteUrl(liveUrl, ownerPass) : liveUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary min-h-11 gap-2"
            onClick={() => track("site")}
          >
            Open site <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
        {!readonly && (
          <a
            href="#people"
            className="ui-btn-secondary min-h-11 gap-2"
            onClick={() => track("invite")}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite
          </a>
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
    const response = await patchJson(`/api/projects/${projectId}`, { title: next });
    if (!response.ok) return setError("That name was not saved. Try again.");
    setDraft(null);
    setError("");
    router.refresh();
  };
  if (draft === null)
    return (
      <div className="flex items-start gap-2">
        <h1 className="ui-project-title min-w-0">{name}</h1>
        <button
          type="button"
          className="ui-btn-icon mt-1 h-11 w-11 shrink-0"
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
