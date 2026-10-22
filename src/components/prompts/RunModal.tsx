"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, X } from "lucide-react";
import { ChatThread } from "@bitbaum/chatkit/react";
import type { PromptTemplate } from "@/config/prompt-library";
import type { Project } from "./types";
import { Modal } from "@/components/ui/modal";
import { postJson } from "@/lib/api/fetch";
import { fetchFeedbackFile } from "@/lib/feedback/fetch-export";
import { renderTextAttachments, type TextAttachment } from "@/lib/loki/attachments";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { useSessionAsk } from "@/hooks/use-session-ask";
import { useLiveStatus } from "@/hooks/use-live-status";
import { needsProject, parsePromptVariables, renderPromptBody } from "@/lib/prompt-vars";
import { promptWorker, sendResultLine } from "@/lib/prompt-run";
import { PromptProjectField, usePromptProject } from "./PromptProjectField";
import { PromptPreview, PromptVariableFields } from "./PromptPreview";

/** A send to a project, as the sheet tracks it after the button. */
type Sent = {
  projectId: string;
  projectTitle: string;
  commandId: string | null;
  runId: string | null;
  waitingForBuilder: boolean;
};

/**
 * The Run sheet: one prompt, what it still needs, and ONE Run button.
 *
 * Rebuilt 2026-10-21 from the owner's phone: two equal buttons ("Run with
 * Loki" / "Send to terminal") each with a paragraph explaining itself; a
 * "Running…" that waited a minute with nothing moving; and "Dispatch failed —
 * no running agent for 'substrata' on this runner" for every project that had
 * only a repository. Now:
 *
 * - The prompt's worker leads (lib/prompt-run promptWorker): work in a project
 *   goes to that project's agent — started for it if none is running, the
 *   same start-or-queue path the rest of Loki uses — and the personal prompts
 *   go to Loki. The other worker is one quiet line below.
 * - Loki's answer streams into the sheet as the chat draws it, with a clock
 *   and Stop, and opens in Loki chat to carry on.
 * - A send ends in one sentence and "Watch it work".
 * - Nothing is shown or sent with a blank still in it (PromptPreview).
 */
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
  const titleId = useId();
  const needed = needsProject(template);
  const worker = promptWorker(template);
  const { project, projectId, setProjectId } = usePromptProject(projects, pinnedProjectId);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const live = useDispatchLiveStatus(sent?.commandId ?? null, sent?.runId ?? null);
  const ask = useSessionAsk(project?.name ?? null);
  const liveStatus = useLiveStatus(ask.live);

  // Every {{variable}} the body declares. project_name comes from the project
  // picker; the rest get a field each.
  const declared = parsePromptVariables(template.template);
  const extraVars = declared.filter((v) => v.name !== "project_name");
  const values: Record<string, string> = { ...varValues };
  if (project) values.project_name = project.name;
  const missingVars = extraVars.filter(
    (v) => !varValues[v.name]?.trim() && v.defaultValue === undefined,
  );
  // Asked for in words, above the button, until nothing is missing. The
  // prompt is never sent with a blank in it.
  const missing = [
    ...(needed && !project ? ["pick a project"] : []),
    ...(missingVars.length > 0
      ? [`fill in ${missingVars.map((v) => v.name.replace(/_/g, " ")).join(", ")}`]
      : []),
  ];
  const complete = missing.length === 0;
  const resolved = complete ? renderPromptBody(template.template, values) : null;
  const missingSentence = complete
    ? null
    : `${missing.join(" and ").replace(/^./, (c) => c.toUpperCase())} first.`;

  // Who can take it. A team project you can read but not work in cannot be
  // sent to; Loki can still answer about it.
  const sendBlocked = !project
    ? "Pick a project to run it there."
    : project.readonly
      ? "This is a team project you can read but not send work to."
      : null;
  const canSend = complete && !sendBlocked;
  const askBusy = ask.sending;
  const asked = ask.messages.length > 0 || !!ask.live;
  const busy = sending || askBusy;

  // A prompt that needs Loki's records gets them attached: the agent cannot
  // read Loki's database (config/prompt-library LokiRecord).
  const lokiRecords = async (projectKey: string): Promise<TextAttachment[]> => {
    if (!template.attach?.includes("feedback")) return [];
    const got = await fetchFeedbackFile(projectKey);
    return got.ok ? [got.file] : [];
  };

  const send = async () => {
    if (!canSend || !project || !resolved || sending) return;
    setSending(true);
    setSendError(null);
    setSent(null);
    try {
      const attachments = await lokiRecords(project.name);
      const res = await postJson("/api/control/tab-inject", {
        tab: project.name,
        prompt: resolved,
        ...(attachments.length ? { attachments } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        // The server's sentence when it wrote one for a person; never a
        // status code.
        setSendError(
          typeof data.error === "string"
            ? data.error
            : `Could not reach ${project.title}. Try again.`,
        );
        return;
      }
      // Someone is typing in that session right now; nothing was sent.
      if (data.blocked) {
        setSendError(`Someone is typing in ${project.title} right now. Try again in a moment.`);
        return;
      }
      setSent({
        projectId: project.id,
        projectTitle: project.title,
        commandId: typeof data.commandId === "string" ? data.commandId : null,
        runId: typeof data.runId === "string" ? data.runId : null,
        waitingForBuilder: data.warning === "runner-offline",
      });
    } catch {
      setSendError("No connection. Try again.");
    } finally {
      setSending(false);
    }
  };

  const askLoki = async () => {
    if (!complete || !resolved || askBusy) return;
    const files = project ? await lokiRecords(project.name) : [];
    await ask.ask(resolved + renderTextAttachments(files), { shown: template.name });
  };

  const result = sent
    ? sendResultLine({
        status: live?.status ?? null,
        waitingForBuilder: sent.waitingForBuilder,
        project: sent.projectTitle,
      })
    : null;

  // The ONE filled button, and the quiet other way.
  const primary =
    worker === "agent"
      ? {
          label: sending
            ? "Sending…"
            : result?.failed
              ? "Try again"
              : sent
                ? "Sent"
                : project
                  ? `Run in ${project.title}`
                  : "Run",
          // Once sent it stays sent: a second tap would start a second agent
          // on the same work. Picking another project starts afresh.
          disabled: !canSend || sending || (!!sent && !result?.failed),
          onClick: send,
        }
      : {
          label: askBusy ? "Loki is answering…" : asked ? "Ask again" : "Ask Loki",
          disabled: !complete || askBusy,
          onClick: askLoki,
        };
  const secondary =
    worker === "agent"
      ? complete && !asked
        ? { label: "Ask Loki about it instead", onClick: askLoki, disabled: askBusy }
        : null
      : canSend && !sent
        ? { label: `Run it in ${project!.title} instead`, onClick: send, disabled: sending }
        : null;
  const footReason =
    worker === "agent" ? (missingSentence ?? (complete ? sendBlocked : null)) : missingSentence;

  return (
    <Modal
      onClose={onClose}
      size="lg"
      position="bottom-mobile"
      padded={false}
      disableClose={busy}
      labelledBy={titleId}
      className="flex flex-col"
    >
      <div className="ui-prompt-sheet-head">
        <div className="min-w-0">
          <h2 id={titleId} className="ui-prompt-sheet-title">
            {template.name}
          </h2>
          {template.description && <p className="ui-prompt-sheet-desc">{template.description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="ui-topbar-btn shrink-0"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="ui-prompt-sheet-body">
        {(needed || worker === "agent" || projects.length > 0) && (
          <PromptProjectField
            id="run-project"
            projects={projects}
            value={projectId}
            onChange={(id) => {
              setProjectId(id);
              setSent(null);
              setSendError(null);
            }}
            required={needed || worker === "agent"}
          />
        )}

        <PromptVariableFields
          idPrefix="run-var"
          variables={extraVars}
          values={varValues}
          onChange={(name, value) => setVarValues((prev) => ({ ...prev, [name]: value }))}
        />

        <PromptPreview body={template.template} values={values} />
        {template.attach?.includes("feedback") && (
          <p className="text-sm text-text-secondary">
            Your project&apos;s feedback reports go with it as a file.
          </p>
        )}

        {/* Loki's answer, drawn as the chat draws it: streaming, with the
            clock and Stop while it works. */}
        {asked && (
          <div className="ui-prompt-sheet-answer">
            <ChatThread
              messages={ask.messages}
              live={ask.live ? { text: ask.live.preview, status: liveStatus } : null}
              stopped={ask.stopped}
              onStop={ask.stop}
              onReply={(text) => void ask.reply(text)}
            />
            {ask.conversationId && !askBusy && (
              <Link href={`/loki?c=${ask.conversationId}`} className="ui-prompt-sheet-link">
                Continue in Loki <ArrowUpRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>
        )}
        {ask.error && (
          <p className="ui-prompt-sheet-error" role="alert">
            Loki could not answer this time.{" "}
            <button type="button" onClick={() => void askLoki()} className="ui-link-muted">
              Try again
            </button>
          </p>
        )}
      </div>

      <div className="ui-sheet-foot flex flex-col gap-2">
        {result && sent && (
          <p className="ui-prompt-sheet-result" role="status">
            <span className={result.failed ? "text-status-negative" : undefined}>
              {result.text}
            </span>{" "}
            <Link
              href={`/projects/${sent.projectId}/watch${sent.runId ? `?run=${sent.runId}` : ""}`}
              className="ui-prompt-sheet-link"
            >
              Watch it work
            </Link>
          </p>
        )}
        {sendError && (
          <p className="ui-prompt-sheet-error" role="alert">
            {sendError}
          </p>
        )}
        {footReason && !sent && <p className="text-sm text-text-secondary">{footReason}</p>}
        <button
          type="button"
          onClick={() => void primary.onClick()}
          disabled={primary.disabled}
          className="ui-btn-primary min-h-12 w-full"
        >
          {(sending && worker === "agent") || (askBusy && worker === "loki") ? (
            <Loader2 className="ui-spinner" />
          ) : null}
          {primary.label}
        </button>
        {secondary && (
          <button
            type="button"
            onClick={() => void secondary.onClick()}
            disabled={secondary.disabled}
            className="ui-btn-ghost min-h-11 w-full"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </Modal>
  );
}
