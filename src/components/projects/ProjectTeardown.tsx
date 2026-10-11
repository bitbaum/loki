"use client";

import { useState } from "react";
import { Archive, ExternalLink, FolderX, Loader2, Trash2 } from "lucide-react";
import { deleteJson, throwApiError } from "@/lib/api/fetch";

export function ProjectTeardown({
  projectId,
  projectName,
  hasSite,
  hasRepo,
  repoUrl,
  codeKeptByLoki = false,
  hasLocalPath,
  onDeleted,
}: {
  projectId: string;
  /** Typed back by the operator to confirm — the bar account deletion sets. */
  projectName: string;
  /** Whether this project HAS a deployed site, so the note can point at the
   *  panel that controls it. Pointing at a panel that is not rendered — which
   *  is every project without a site — is worse than saying nothing. */
  hasSite: boolean;
  hasRepo: boolean;
  /** The linked repository, so deleting it on GitHub is one click away. */
  repoUrl?: string | null;
  /** Loki keeps the code: the person has no GitHub to delete it on, and the
   *  words "GitHub repository" mean nothing to them. */
  codeKeptByLoki?: boolean;
  hasLocalPath: boolean;
  onDeleted: () => void;
}) {
  const [deprovision, setDeprovision] = useState<"none" | "archive-repo">("none");
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [armed, setArmed] = useState(false);
  // Deleting a project takes its brief, milestones and feedback with it and
  // cannot be undone. Arming a button is a reflex; typing the name is a
  // decision — and it is what deleting an ACCOUNT already asks for here.
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (deprovision !== "none") params.set("deprovision", deprovision);
      if (deleteLocal) params.set("deleteLocal", "1");
      const res = await deleteJson(`/api/projects/${projectId}${params.size ? `?${params}` : ""}`);
      if (!res.ok) await throwApiError(res, "Failed to delete project");
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 border-t border-border-subtle pt-5">
      <div className="flex items-center gap-2 text-sm font-medium text-status-negative">
        <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Danger zone
      </div>
      <p className="text-xs text-text-tertiary">
        This removes the project from Loki — its brief, milestones, feedback and settings — and, if
        you ask, its repository.
        {hasSite
          ? " It does not take the live site off the internet: use “The live site” above for that."
          : " This project has no deployed site, so there is nothing public to take down."}
      </p>
      <p className="text-xs text-text-tertiary">
        What agents actually did — runs, prompts and their outcomes — is kept as history, under the
        project&rsquo;s name. Queued work that has not run yet is cancelled with the project.
      </p>
      <div className="space-y-4">
        <div className="space-y-2 text-xs text-text-secondary">
          {hasRepo && (
            <>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  className="h-5 w-5 shrink-0"
                  type="radio"
                  checked={deprovision === "none"}
                  onChange={() => setDeprovision("none")}
                />
                {codeKeptByLoki
                  ? "Keep the code where Loki holds it"
                  : "Keep linked GitHub repository"}
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  className="h-5 w-5 shrink-0"
                  type="radio"
                  checked={deprovision === "archive-repo"}
                  onChange={() => setDeprovision("archive-repo")}
                />
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                {codeKeptByLoki ? "Put the code away (archive)" : "Archive GitHub repository"}
              </label>
              {/* No "delete the repository" option, and not an oversight: no
                  credential Loki holds carries GitHub's delete_repo
                  scope, by design, so the app can never destroy code that
                  cannot be recovered. Offering a button that always fails
                  would be worse than sending people where it works. */}
              <p className="text-xs text-text-tertiary">
                {codeKeptByLoki
                  ? "Archived code is kept, read-only, and can be brought back — Loki never destroys code."
                  : "Deleting the repository outright happens on GitHub — Loki can archive it, but never destroy it."}{" "}
                {repoUrl && !codeKeptByLoki && (
                  <a
                    className="inline-flex items-center gap-1 underline hover:text-text-secondary"
                    href={`${repoUrl.replace(/\.git$/, "")}/settings`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Delete it on GitHub <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </p>
            </>
          )}
          {hasLocalPath && (
            <label className="flex min-h-11 items-center gap-2">
              <input
                className="h-5 w-5 shrink-0"
                type="checkbox"
                checked={deleteLocal}
                onChange={(e) => setDeleteLocal(e.target.checked)}
              />
              <FolderX className="h-3.5 w-3.5" aria-hidden="true" /> Delete local checkout under dev
              root
            </label>
          )}
        </div>

        {armed ? (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="ui-kicker">
                Type <span className="font-mono text-text-secondary">{projectName}</span> to confirm
              </span>
              <input
                className="ui-input w-full sm:max-w-xs"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={projectName}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={destroy}
                disabled={busy || typed.trim() !== projectName.trim()}
                className="ui-btn-danger min-h-11 gap-1.5"
              >
                {busy ? <Loader2 className="ui-spinner-xs" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete project
              </button>
              <button
                type="button"
                onClick={() => {
                  setArmed(false);
                  setTyped("");
                  setError(null);
                }}
                className="ui-btn-text-cancel min-h-11"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="ui-btn-danger min-h-11 gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete project
          </button>
        )}
        {error && <p className="ui-error-xs">{error}</p>}
      </div>
    </section>
  );
}
