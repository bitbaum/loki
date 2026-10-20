"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, FolderOpen, Loader2, SquareTerminal, X, Zap } from "lucide-react";
import type { PromptTemplate } from "@/config/prompt-library";
import type { Project } from "./types";
import { Modal } from "@/components/ui/modal";
import { postJson } from "@/lib/api/fetch";
import { fetchFeedbackFile } from "@/lib/feedback/fetch-export";
import { renderTextAttachments, type TextAttachment } from "@/lib/loki/attachments";
import { useClipboard } from "@/hooks/use-clipboard";
import { useFetch } from "@/hooks/use-fetch";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { dispatchStatusLabel, dispatchToneDotClass } from "@/lib/dispatch-status";
import { needsProject, renderPromptBody, parsePromptVariables } from "@/lib/prompt-vars";
import { PromptProjectField, usePromptProject } from "./PromptProjectField";

export function RunModal({
  template,
  projects,
  pinnedProjectId,
  onClose,
}: {
  template: PromptTemplate;
  projects: Project[];
  /** A saved prompt pinned to one project opens on it. */
  pinnedProjectId?: string | null;
  onClose: () => void;
}) {
  const needed = needsProject(template);
  const { project, projectId, setProjectId } = usePromptProject(projects, pinnedProjectId);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useClipboard();

  // Which sessions are open, only to say whether "Send to terminal" types into
  // a running agent or starts one: tab-inject handles both (it queues a
  // self-starting dispatch when nothing is running), so a closed session is no
  // reason to refuse.
  const { data: tabsData } = useFetch<{ tabs: string[] }>("/api/control/open-tabs");
  const openTabs = tabsData?.tabs ?? [];
  const [dispatching, setDispatching] = useState(false);
  const [dispatchedTo, setDispatchedTo] = useState<string | null>(null);
  // What tab-inject's response actually reported — tracked so the confirmation
  // line can say what really happened instead of the same "Sent to X" whether
  // the prompt ran immediately or queued behind an offline builder.
  const [trackedCommandId, setTrackedCommandId] = useState<string | null>(null);
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
  // Fallback when neither id came back (no dirPath on this project, so no
  // tracked run was created) — still enough to say ran-now vs queued rather
  // than defaulting to a bare "Sent" forever.
  const [trackedMode, setTrackedMode] = useState<string | null>(null);
  const liveDispatch = useDispatchLiveStatus(trackedCommandId, trackedRunId);

  // Every {{variable}} the body declares. project_name comes from the project
  // picker; the rest get a field each.
  const declared = parsePromptVariables(template.template);
  const extraVars = declared.filter((v) => v.name !== "project_name");
  const values: Record<string, string> = { ...varValues };
  if (project) values.project_name = project.name;
  const missingVars = extraVars.filter(
    (v) => !varValues[v.name]?.trim() && v.defaultValue === undefined,
  );
  const missingProject = needed && !project;
  // What is still needed before the prompt is complete, in words. The
  // resolved prompt is not shown — and cannot be run — until nothing is: a
  // preview reading "{{project_name}}" with no field to fill it was the bug
  // (2026-10-20).
  const missing = [
    ...(missingProject ? ["pick a project"] : []),
    ...(missingVars.length > 0
      ? [`fill in ${missingVars.map((v) => v.name.replace(/_/g, " ")).join(", ")}`]
      : []),
  ];
  const resolvedMessage = missing.length === 0 ? renderPromptBody(template.template, values) : null;

  const canRun = resolvedMessage !== null;
  const sendBlocked = !project
    ? "Pick a project to send it to that project's session."
    : project.readonly
      ? "This is a team project you can read but not send work to."
      : null;
  const canSend = canRun && !sendBlocked;
  const sessionOpen = project
    ? openTabs.some((tab) => tab.toLowerCase() === project.name.toLowerCase())
    : false;
  const missingSentence = missing.length
    ? `${missing.join(" and ").replace(/^./, (c) => c.toUpperCase())} first.`
    : "";

  // A prompt that needs Loki's records gets them attached: the agent cannot
  // read Loki's database (config/prompt-library LokiRecord).
  const lokiRecords = async (projectKey: string): Promise<TextAttachment[]> => {
    if (!template.attach?.includes("feedback")) return [];
    const got = await fetchFeedbackFile(projectKey);
    return got.ok ? [got.file] : [];
  };

  const handleSendToTerminal = async () => {
    if (!canSend || !project || !resolvedMessage || dispatching) return;
    const tab = project.name;
    setDispatching(true);
    setError(null);
    setDispatchedTo(null);
    setTrackedCommandId(null);
    setTrackedRunId(null);
    try {
      const attachments = await lokiRecords(tab);
      const res = await postJson("/api/control/tab-inject", {
        tab,
        prompt: resolvedMessage,
        ...(attachments.length ? { attachments } : {}),
      });
      // postJson never throws on a non-2xx status (it's a bare fetch) — a
      // 401/500 from tab-inject must not read as "Sent".
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : `Could not send (HTTP ${res.status}).`,
        );
        return;
      }
      // The runner detected the operator actively typing in this exact
      // session and refused to interleave — nothing was injected, but the
      // HTTP call still succeeded.
      if (data.blocked) {
        setError(
          `Not sent — someone is typing in “${project.title}” right now. Wait a moment and try again.`,
        );
        return;
      }
      setDispatchedTo(tab);
      setTrackedCommandId(typeof data.commandId === "string" ? data.commandId : null);
      setTrackedRunId(typeof data.runId === "string" ? data.runId : null);
      setTrackedMode(typeof data.mode === "string" ? data.mode : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDispatching(false);
    }
  };

  const handleRun = async () => {
    if (!canRun || !resolvedMessage || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      // The same file the session gets, folded into the message: the prompt
      // says "the attached file", and it must be true on both paths.
      const files = project ? await lokiRecords(project.name) : [];
      const res = await postJson("/api/loki", {
        message: resolvedMessage + renderTextAttachments(files),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResult(data.text ?? "");
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Modal
        onClose={onClose}
        size="2xl"
        padded={false}
        disableClose={running}
        className="flex flex-col"
      >
        <div className="shrink-0 border-b border-border-subtle p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold text-text-primary">{template.name}</div>
              <div className="mt-1 text-base text-text-secondary">{template.description}</div>
            </div>
            <button
              onClick={onClose}
              disabled={running}
              className="ui-btn-overlay p-2 disabled:opacity-30"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {/* What the prompt needs comes first, then the prompt it makes. */}
          <div>
            <PromptProjectField
              id="run-project"
              projects={projects}
              value={projectId}
              onChange={setProjectId}
              required={needed}
              hint={
                needed
                  ? "The prompt is written for one project."
                  : "Optional for Run with Loki. Send to terminal needs one."
              }
            />
            {project && (
              <Link
                href={`/projects/${project.id}`}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-text-tertiary underline-offset-2 hover:underline"
              >
                <FolderOpen className="h-3.5 w-3.5" /> Open {project.title}
              </Link>
            )}
          </div>

          {extraVars.length > 0 && (
            <div className="space-y-3">
              <div className="ui-kicker text-text-tertiary">
                Fill in
                {missingVars.length > 0 && (
                  <span className="ui-tag ui-tag-warning ml-2">{missingVars.length} to go</span>
                )}
              </div>
              {extraVars.map((v) => (
                <div key={v.name}>
                  <label className="ui-micro-label mb-1 block" htmlFor={`var-${v.name}`}>
                    {v.name.replace(/_/g, " ")}
                    {v.defaultValue !== undefined && (
                      <span className="text-text-muted"> · defaults to {v.defaultValue}</span>
                    )}
                  </label>
                  <input
                    id={`var-${v.name}`}
                    value={varValues[v.name] ?? ""}
                    onChange={(e) =>
                      setVarValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                    }
                    placeholder={v.defaultValue ?? `Value for ${v.name.replace(/_/g, " ")}`}
                    className="ui-input"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="ui-kicker mb-2">The prompt</div>
            {resolvedMessage !== null ? (
              <pre className="ui-code-surface">{resolvedMessage}</pre>
            ) : (
              <p className="rounded-xl border border-border-subtle p-4 text-sm text-text-secondary">
                {missingSentence} The full prompt shows here once it is complete.
              </p>
            )}
            {template.attach?.includes("feedback") && (
              <p className="mt-2 text-xs text-text-secondary">
                Run with Loki or sent to a session, it carries the project&apos;s feedback reports
                from Loki as an attached file — the agent cannot see them otherwise.
              </p>
            )}
          </div>

          {/* The heading and Copy button belong to the "Run with Loki" flow
              only; errors from either action share the slot below. */}
          {(running || result) && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="ui-kicker">Loki&apos;s answer</span>
                {result && (
                  <button
                    onClick={() => copy(result)}
                    className="flex items-center gap-1 text-sm font-medium text-text-tertiary transition-colors hover:text-text-primary"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
              {running && (
                <div className="ui-card-shell flex items-center gap-2 p-4 text-base text-text-secondary">
                  <Loader2 className="ui-spinner text-accent-primary" />
                  Loki is working… (this may take up to 60s)
                </div>
              )}
              {result && <pre className="ui-code-surface">{result}</pre>}
            </div>
          )}
          {error && <div className="ui-box-error">{error}</div>}
        </div>

        {/* Two actions, two different workers — each says which, in one line,
            and a disabled one says why beside it instead of fading out. */}
        <div className="shrink-0 space-y-3 border-t border-border-subtle p-6">
          <div className="flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={!canRun || running}
              className="ui-btn-primary min-h-11 shrink-0"
            >
              {running ? <Loader2 className="ui-spinner" /> : <Zap className="h-4 w-4" />}
              {running ? "Running…" : "Run with Loki"}
            </button>
            <p className="min-w-0 text-xs text-text-secondary">
              {canRun ? "Loki answers here, in this window." : missingSentence}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSendToTerminal}
              disabled={!canSend || dispatching}
              className="ui-btn-secondary min-h-11 shrink-0"
            >
              {dispatching ? (
                <Loader2 className="ui-spinner" />
              ) : (
                <SquareTerminal className="h-4 w-4" />
              )}
              {dispatching ? "Sending…" : "Send to terminal"}
            </button>
            <p className="min-w-0 text-xs text-text-secondary">
              {sendBlocked ??
                (!canRun
                  ? missingSentence
                  : sessionOpen
                    ? `The agent in ${project!.title}'s session does the work.`
                    : `An agent in ${project!.title}'s session does the work — started for it, or queued if the builder is offline.`)}
            </p>
          </div>
          {/* The real lifecycle of a send (queued/working/failed…), turning
              positive only once it is confirmed. */}
          {dispatchedTo && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={dispatchToneDotClass(liveDispatch?.tone ?? "neutral")} />
              <span className="text-text-secondary">
                {liveDispatch?.label ?? dispatchStatusLabel({ ok: true, mode: trackedMode }).label}
              </span>
              {liveDispatch?.detail && (
                <span className="text-text-tertiary">— {liveDispatch.detail}</span>
              )}
              <Link
                href={`/terminal?project=${encodeURIComponent(dispatchedTo)}`}
                className="ui-dispatch-watch-link"
              >
                <SquareTerminal className="h-3.5 w-3.5" /> Watch
              </Link>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
