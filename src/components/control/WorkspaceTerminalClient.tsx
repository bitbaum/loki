"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { TerminalView } from "@/components/terminal/TerminalView";
import { workspaceTransport } from "@/components/terminal/terminal-transport";
import type { AgentLifecycle } from "@/lib/agent-execution/types";

type ViewStatus = AgentLifecycle | "provisioning" | "error";

/**
 * Live embedded terminal over a Loki-owned PTY (LocalPtyExecutor).
 * Only rendered when `decideWorkspaceAccess` allows server workspaces.
 */
export function WorkspaceTerminalClient() {
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewStatus>("provisioning");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{ project: string; cmd: string; dir: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectKey = params.get("project") ?? "scratch";
    const cwd = params.get("dir") ?? undefined;
    const agent = params.get("agent");
    const model = params.get("model") ?? undefined;
    const command = agent ? undefined : (params.get("cmd") ?? "bash");
    const args = agent ? undefined : params.getAll("arg");

    (async () => {
      try {
        const res = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectKey, cwd, command, args, agent, model }),
        });
        const data = await res.json();
        setMeta({
          project: projectKey,
          cmd: agent ?? [command, ...(args ?? [])].join(" "),
          dir: cwd ?? "(server home)",
        });
        if (!res.ok) {
          setStatus("error");
          setError(data?.error ?? `provision failed (${res.status})`);
          return;
        }
        setId(data.workspace.id);
        setStatus(data.workspace.status as AgentLifecycle);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const exitedFast = status === "exited" || status === "error";

  return (
    <div className="app-page app-page-compact app-viewport-pane flex flex-col gap-2 md:gap-3">
      <Link href="/control" className="ui-btn-ghost ui-btn-xs self-start gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Control
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="ui-page-title">Workspace terminal</h1>
        <span className="ui-badge">{status}</span>
        {meta && (
          <span className="ui-micro-label max-w-full truncate">
            {meta.cmd} · {meta.dir}
          </span>
        )}
      </div>

      <details className="ui-callout-warning md:hidden">
        <summary className="cursor-pointer text-sm font-medium text-text-secondary">
          Server-hosted terminal note
        </summary>
        <div className="mt-2 text-sm leading-relaxed text-text-secondary">
          {exitedFast ? (
            <>
              This embedded terminal runs on the server hosting Loki, which can&apos;t reach your
              machine when you&apos;re on the hosted app — so the agent exited.{" "}
            </>
          ) : (
            <>This embedded terminal runs on the server hosting Loki. </>
          )}
          To have an agent work on a project, use <strong>Dispatch</strong> on it in{" "}
          <Link href="/control" className="text-accent-text underline">
            Control
          </Link>{" "}
          — it runs on your connected Fleet Runner or the cloud runner.
        </div>
      </details>
      <div className="ui-callout-warning hidden md:flex">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
        <div className="text-sm leading-relaxed text-text-secondary">
          {exitedFast ? (
            <>
              This embedded terminal runs on the server hosting Loki, which can&apos;t reach your
              machine when you&apos;re on the hosted app — so the agent exited.{" "}
            </>
          ) : (
            <>This embedded terminal runs on the server hosting Loki. </>
          )}
          To have an agent work on a project, use <strong>Dispatch</strong> on it in{" "}
          <Link href="/control" className="text-accent-text underline">
            Control
          </Link>{" "}
          — it runs on your connected Fleet Runner or the cloud runner.
        </div>
      </div>

      {error && <p className="ui-error">{error}</p>}
      {id && (
        <div className="ui-panel min-h-0 flex-1 overflow-hidden p-2">
          <TerminalView
            transport={workspaceTransport(id)}
            interactive
            bare
            onStatus={setStatus}
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}
