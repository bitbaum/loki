"use client";

import { useState } from "react";
import { Composer } from "@/components/composer/Composer";
import { Modal } from "@/components/ui/modal";
import { postJson } from "@/lib/api/fetch";
import { LOKI_REFRESH_EVENT } from "@/lib/client-events";
import { MAX_TASK_PROJECTS } from "@/lib/multi-dispatch-prompt";
import type { MultiDispatchResult, ProjectTaskOutcome } from "@/lib/multi-project-dispatch";

/**
 * One task to every project selected on the rail. The agents each get the
 * same words plus a line naming the others (lib/multi-dispatch-prompt.ts), so
 * a task that spans OrangeCat and Loki is written once, not pasted twice.
 */
export function SendTaskModal({
  projects,
  onClose,
  onSent,
}: {
  projects: string[];
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<ProjectTaskOutcome[]>([]);
  // Narrows to the projects that refused after a partial send, so "send again"
  // retries those and never re-sends to a project that already has the task.
  const [targets, setTargets] = useState(projects);
  const tooMany = targets.length > MAX_TASK_PROJECTS;

  const send = async (text: string): Promise<boolean> => {
    setSending(true);
    setError(null);
    setFailures([]);
    try {
      const res = await postJson("/api/inject/multi", { task: text, projects: targets });
      const body = (await res.json().catch(() => ({}))) as Partial<MultiDispatchResult> & {
        error?: string;
      };
      if (!res.ok || !("results" in body) || !body.results) {
        setError(body.error ?? `Nothing was sent (HTTP ${res.status}).`);
        return false;
      }
      window.dispatchEvent(new CustomEvent(LOKI_REFRESH_EVENT));
      const failed = body.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        // Keep the modal open on a partial send: the person needs to see which
        // project did not get it, and the draft is still here to resend to them.
        setFailures(failed);
        setTargets(failed.map((f) => f.project));
        setError(
          `Sent to ${body.sent} of ${body.results.length}. Not sent — send again to retry only these:`,
        );
        return false;
      }
      const queued = body.results.filter((r) => r.mode === "queued").length;
      onSent(
        `Task sent to ${body.results.map((r) => r.project).join(", ")}` +
          (queued ? ` — ${queued} queued until a builder picks it up.` : "."),
      );
      onClose();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nothing was sent.");
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose} size="lg" disableClose={sending}>
      <div className="space-y-1">
        <h2 className="ui-page-title text-base">
          Send a task to {targets.length} project{targets.length === 1 ? "" : "s"}
        </h2>
        <p className="ui-page-subtitle">
          {targets.join(", ")} — each agent gets the same words and is told which other projects are
          working on it, so it does only its own part.
        </p>
      </div>
      {tooMany ? (
        <p className="ui-error">
          At most {MAX_TASK_PROJECTS} projects at once — each one starts a whole agent. Clear a few
          from the selection.
        </p>
      ) : (
        <Composer
          onSend={(text) => send(text)}
          placeholder="Describe the task once, e.g. Make it so I can post prompts in OrangeCat and Loki"
          ariaLabel="Task for the selected projects"
          attach={false}
          sending={sending}
        />
      )}
      {error && (
        <div className="space-y-1">
          <p className="ui-error">{error}</p>
          {failures.map((f) => (
            <p key={f.project} className="text-xs text-text-secondary">
              {f.project}: {f.message ?? "refused"}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}
