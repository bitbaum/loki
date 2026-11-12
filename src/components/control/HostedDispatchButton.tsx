"use client";

// "Run in cloud" — intentionally dispatch a coding task to the hosted Hermes
// runner from Control. Self-contained (own text + submit + feedback state) so it
// drops into the intent panel's "More" row with just the project key; it does
// NOT thread through the hand-rolled useProjectCardActions dispatch state.
//
// Unlike the composer's Send (which needs the local Fleet Runner or auto-routes
// to Hermes only when it's offline), this ALWAYS goes to the hosted runner:
// clone → Hermes → PR, laptop-off, never auto-merged. Progress shows in Activity.

import { useState } from "react";
import { CloudUpload, Loader2, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { postJson, throwApiError } from "@/lib/api/fetch";

type DispatchOk = { ok: true; hostedDispatchId: string; projectName: string; gitUrl: string };

export function HostedDispatchButton({
  projectTab,
  projectName,
  initialTask = "",
}: {
  projectTab: string;
  projectName: string;
  initialTask?: string;
}) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState(initialTask);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DispatchOk | null>(null);

  const openModal = () => {
    setTask(initialTask);
    setError(null);
    setDone(null);
    setOpen(true);
  };

  const submit = async () => {
    const trimmed = task.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await postJson("/api/hermes/dispatch", { projectKey: projectTab, task: trimmed });
      if (!res.ok) await throwApiError(res, "Dispatch failed");
      setDone((await res.json()) as DispatchOk);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={openModal}
        title="Send a coding task to the hosted runner (Hermes) — clones the repo, makes the change, opens a PR. Runs laptop-off; never auto-merges."
        className="ui-chip-action-compact inline-flex items-center gap-1.5 text-text-tertiary hover:text-accent-primary"
      >
        <CloudUpload className="h-3.5 w-3.5" />
        Run in cloud
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} size="md" disableClose={submitting}>
          <div className="space-y-1">
            <h2 className="ui-page-title text-base">Run in cloud · {projectName}</h2>
            <p className="ui-page-subtitle">
              Hermes clones the repo, makes the change, and opens a PR — laptop-off. Nothing
              auto-merges; you review it. Progress shows in Activity.
            </p>
          </div>

          {done ? (
            <div className="space-y-3">
              <div className="ui-tag-positive inline-flex items-center gap-1.5">
                ✓ Queued — a PR will open shortly.
              </div>
              <p className="ui-micro-label break-all">dispatch {done.hostedDispatchId}</p>
              <a href="/activity" className="ui-btn-secondary inline-flex items-center gap-1.5">
                Watch in Activity <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : (
            <>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={5}
                autoFocus
                placeholder="Describe the change… e.g. Add a CONTRIBUTING.md with build + test steps"
                className="ui-input w-full resize-y"
                disabled={submitting}
              />
              {error && <p className="ui-error">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="ui-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={submitting || !task.trim()}
                  className="ui-btn-primary inline-flex items-center gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="ui-spinner-sm" />
                  ) : (
                    <CloudUpload className="h-4 w-4" />
                  )}
                  Dispatch to Hermes
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
