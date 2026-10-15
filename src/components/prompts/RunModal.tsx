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
import { renderPromptBody, parsePromptVariables } from "@/lib/prompt-vars";

export function RunModal({
  template,
  projects,
  onClose,
}: {
  template: PromptTemplate;
  projects: Project[];
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(template.scope === "global" ? "__global__" : "");
  const [projectName, setProjectName] = useState("");
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useClipboard();

  // Live agent sessions, so a template can be sent to the thing that will run
  // it. Until now the library's only verb was "Run with Loki" — a chat
  // completion that answers in a modal and touches no repo — so every prompt
  // meant for an agent had to be copied out of this page by hand.
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

  // Every {{variable}} the body declares, not just project_name. User-owned
  // prompts arrive here through asTemplate() in UserPromptsSection and may
  // declare anything; the old replaceAll dispatched their braces verbatim.
  const declared = parsePromptVariables(template.template);
  const extraVars = declared.filter((v) => v.name !== "project_name");
  const values: Record<string, string> = { ...varValues };
  if (projectName) values.project_name = projectName;
  const resolvedMessage = renderPromptBody(template.template, values);
  // A variable with no value and no default still reads as {{name}} in the
  // preview — deliberately, so a half-filled prompt is visible before dispatch
  // rather than after.
  const missingVars = extraVars.filter(
    (v) => !varValues[v.name]?.trim() && v.defaultValue === undefined,
  );

  const canRun = template.scope === "global" || !!projectId;

  // Prefer the tab matching the chosen project; otherwise the only open one.
  // Never guess between several unrelated sessions — dispatching into the wrong
  // agent is not a recoverable mistake.
  const targetTab =
    openTabs.find((tab) => tab.toLowerCase() === projectName.toLowerCase()) ??
    (openTabs.length === 1 ? openTabs[0] : null);

  // A prompt that needs Loki's records gets them attached: the agent cannot
  // read Loki's database (config/prompt-library LokiRecord).
  const lokiRecords = async (project: string): Promise<TextAttachment[]> => {
    if (!template.attach?.includes("feedback")) return [];
    const got = await fetchFeedbackFile(project);
    return got.ok ? [got.file] : [];
  };

  const handleSendToTerminal = async () => {
    if (!targetTab || dispatching) return;
    setDispatching(true);
    setError(null);
    setDispatchedTo(null);
    setTrackedCommandId(null);
    setTrackedRunId(null);
    try {
      const attachments = await lokiRecords(projectName || targetTab);
      const res = await postJson("/api/control/tab-inject", {
        tab: targetTab,
        prompt: resolvedMessage,
        ...(attachments.length ? { attachments } : {}),
      });
      // postJson never throws on a non-2xx status (it's a bare fetch) — the
      // previous version skipped this check entirely, so a 401/500 from
      // tab-inject still flipped the modal to "Sent to X. Watch it in
      // Terminal →" in green. It hadn't sent anything.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : `Could not send (HTTP ${res.status}).`,
        );
        return;
      }
      // The runner detected the operator actively typing in this exact
      // session and refused to interleave — nothing was injected, but the
      // HTTP call still succeeded. Showing "Sent" here would be the same lie
      // this fix exists to remove, just from a different response shape.
      if (data.blocked) {
        setError(
          `Not sent — someone is typing in “${targetTab}” right now. Wait a moment and try again.`,
        );
        return;
      }
      setDispatchedTo(targetTab);
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
    if (!canRun || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      // The same file the session gets, folded into the message: the prompt
      // says "the attached file", and it must be true on both paths.
      const files = projectName ? await lokiRecords(projectName) : [];
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

  const handleCopy = () => {
    if (result) copy(result);
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
            <div>
              <div className="text-xl font-semibold text-text-primary">{template.name}</div>
              <div className="mt-1 text-base text-text-secondary">{template.description}</div>
            </div>
            <button
              onClick={onClose}
              disabled={running}
              className="ui-btn-overlay p-2 disabled:opacity-30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <div>
            <div className="ui-kicker mb-2">Resolved Prompt</div>
            <pre className="ui-code-surface">{resolvedMessage}</pre>
            {template.attach?.includes("feedback") && (
              <p className="mt-2 text-xs text-text-secondary">
                Run with Loki or sent to a session, it carries the project&apos;s feedback reports
                from Loki as an attached file — the agent cannot see them otherwise.
              </p>
            )}
          </div>

          {extraVars.length > 0 && (
            <div className="space-y-3">
              <div className="ui-kicker text-text-tertiary">
                Variables
                {missingVars.length > 0 && (
                  <span className="ui-tag ui-tag-warning ml-2">{missingVars.length} unfilled</span>
                )}
              </div>
              {extraVars.map((v) => (
                <div key={v.name}>
                  <label className="ui-micro-label mb-1 block" htmlFor={`var-${v.name}`}>
                    {v.name}
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
                    placeholder={v.defaultValue ?? `Value for ${v.name}`}
                    className="ui-input"
                  />
                </div>
              ))}
            </div>
          )}

          {template.scope === "project" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="ui-kicker text-text-tertiary">Project</label>
                {projectId && projectId !== "__global__" && (
                  <Link
                    href={`/projects/${projectId}`}
                    className="flex items-center gap-1 text-sm font-medium text-accent-text transition-colors hover:text-accent-hover"
                  >
                    <FolderOpen className="h-4 w-4" /> View Project
                  </Link>
                )}
              </div>
              <select
                value={projectId}
                onChange={(e) => {
                  const p = projects.find((p) => p.id === e.target.value);
                  setProjectId(e.target.value);
                  setProjectName(p?.name ?? "");
                }}
                className="ui-input"
              >
                <option value="">— Select project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* The heading and Copy button belong to the "Run with Loki" flow
              only — "Send to terminal" errors (blocked, offline, HTTP failure)
              used to render inside a box labelled "Loki's Response", which is
              wrong for a failure that has nothing to do with Loki chat. Error
              is now a standalone slot below, shared by both actions. */}
          {(running || result) && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span>Loki&apos;s Response</span>
                {result && (
                  <button
                    onClick={handleCopy}
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

        <div className="shrink-0 space-y-2 border-t border-border-subtle p-6">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleRun} disabled={!canRun || running} className="ui-btn-submit">
              {running ? (
                <>
                  <Loader2 className="ui-spinner" /> Running…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" /> Run with Loki
                </>
              )}
            </button>
            <button
              onClick={handleSendToTerminal}
              disabled={!canRun || !targetTab || dispatching}
              title={
                !targetTab
                  ? openTabs.length === 0
                    ? "No agent session is open. Dispatch one from Control first."
                    : "Pick the project whose session this should run in."
                  : `Dispatch into the “${targetTab}” session`
              }
              className="ui-btn-secondary disabled:pointer-events-none disabled:opacity-40"
            >
              {dispatching ? (
                <>
                  <Loader2 className="ui-spinner" /> Sending…
                </>
              ) : (
                <>
                  <SquareTerminal className="h-4 w-4" /> Send to terminal
                </>
              )}
            </button>
          </div>
          {/* "Run with Loki" answers in this modal; "Send to terminal" hands the
              prompt to an agent that can actually change the repo. Saying so
              here is cheaper than a user discovering it by picking wrong. */}
          <p className="text-xs text-text-muted">
            Loki answers here. Send to terminal dispatches into a live agent session — assembled
            with project context, and queued if the builder is offline.
          </p>
          {/* Was: a static green "Sent to X. Watch it in Terminal →" regardless
              of whether tab-inject ran the prompt immediately or queued it
              behind an offline builder — the response body was discarded.
              This now shows the real lifecycle (queued/working/failed…) and
              only turns positive once it's actually confirmed. */}
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
