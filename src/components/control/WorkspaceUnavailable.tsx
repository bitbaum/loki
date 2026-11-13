import Link from "next/link";
import { ArrowLeft, Info, SquareTerminal } from "lucide-react";
import { NAV } from "@/config/navigation";
import { WORKSPACES_CLOUD_DISABLED } from "@/lib/runtime";

/**
 * The workspace page when it cannot open. It used to be an amber warning box
 * of server words ("PTY", "control plane", "peek stream", "dispatch") with
 * three links in one sentence. Not a warning, and not a dead end: one plain
 * line and one way forward, to Terminal, where agents are watched.
 */
export function WorkspaceUnavailable({ error, code }: { error: string; code?: string }) {
  const message = error || WORKSPACES_CLOUD_DISABLED;

  return (
    <div className="app-page app-page-compact app-viewport-pane flex flex-col gap-4">
      <Link href={NAV.control.href} className="ui-btn-ghost ui-tap self-start gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to {NAV.control.label}
      </Link>
      <h1 className="ui-page-title">Watch your agents</h1>
      <div className="ui-callout">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <div className="space-y-3 text-sm leading-relaxed text-text-secondary">
          <p>{message}</p>
          {code === "cloud-builder-private" && (
            <p>
              To run agents on your own computer,{" "}
              <Link href="/download" className="text-accent-text underline">
                install Fleet Runner
              </Link>
              .
            </p>
          )}
        </div>
      </div>
      <Link href={NAV.terminal.href} className="ui-btn-primary self-start gap-1.5">
        <SquareTerminal className="h-4 w-4" aria-hidden="true" />
        Open Terminal
      </Link>
    </div>
  );
}
