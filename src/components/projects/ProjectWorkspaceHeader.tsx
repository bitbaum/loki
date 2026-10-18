"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, MessageSquare, Settings, UserPlus } from "lucide-react";
import { rememberFleetProject } from "@/lib/fleet-context";
import { summarizeDescription } from "@/lib/project-display";
import { ownerSiteUrl } from "../../../widget/owner-pass";
import { trackUsage } from "@/lib/usage/track";
import { ROLE_LABELS } from "@/lib/project-capabilities";
import type { ProjectRole } from "@/db/schema/project-memberships";

/** Identity and the two everyday actions. Configuration belongs in Settings. */
export function ProjectWorkspaceHeader({
  name,
  workspaceKey,
  description,
  liveUrl,
  ownerPass,
  readonly,
  viewerRole = null,
  quiet = false,
}: {
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
        <h1 className="ui-project-title">{name}</h1>
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
