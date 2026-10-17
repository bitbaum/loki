"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, MessageSquare, Settings } from "lucide-react";
import { rememberFleetProject } from "@/lib/fleet-context";
import { summarizeDescription } from "@/lib/project-display";
import { ownerSiteUrl } from "../../../widget/owner-pass";
import { trackUsage } from "@/lib/usage/track";

/** Identity and the two everyday actions. Configuration belongs in Settings. */
export function ProjectWorkspaceHeader({
  name,
  workspaceKey,
  description,
  liveUrl,
  ownerPass,
  readonly,
  quiet = false,
}: {
  name: string;
  workspaceKey: string;
  description: string | null;
  liveUrl: string | null;
  ownerPass: string | null;
  readonly: boolean;
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
        {readonly && <p className="mt-2 text-sm text-text-tertiary">Shared project · View only</p>}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={`/loki?project=${encodeURIComponent(workspaceKey)}`}
          className={`${quiet ? "ui-btn-secondary" : "ui-btn-primary"} min-h-11 gap-2`}
          onClick={() => track("chat")}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" /> Ask Loki
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
      </div>
    </header>
  );
}
