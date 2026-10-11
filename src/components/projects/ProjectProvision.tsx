"use client";

// One-click provisioning: turn a registered idea into a real, dispatchable
// project. Makes a place for the code (a repository Loki keeps, seeded with a
// starter), links it, and sets the dir path the runner clones into — so it
// appears in Control. No GitHub account, no `gh`, no `~/dev`, no terminal.
// Shown only while a project has no repo linked yet.

import { useState } from "react";
import { Loader2, Rocket, GitBranch } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { DEFAULT_PROVISION_TEMPLATE, PROVISION_TEMPLATES } from "@/config/project-templates";

type Done = { repo: { full_name: string; gitUrl: string }; dirPath: string };

export function ProjectProvision({
  projectId,
  onReload,
}: {
  projectId: string;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<string>(DEFAULT_PROVISION_TEMPLATE);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function provision() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/provision`, { template, visibility });
      const json = (await res.json()) as {
        ok?: boolean;
        repo?: Done["repo"];
        dirPath?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone({ repo: json.repo!, dirPath: json.dirPath! });
      setOpen(false);
      onReload();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-xs text-status-positive inline-flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5" />
        The code has a place now — this project is in Control, ready to dispatch.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <button
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          // `ui-btn-chip` reaches the 44px floor through its OWN `py-3` — it is
          // not in the coarse-pointer floor list in globals.css. Overriding to
          // `py-1.5 text-xs` without `ui-tap` made this ~28px on a phone, 16px
          // under the stated floor, and visibly shorter than the seven
          // identical sibling chips (ProjectBriefFill, BusinessPlanSection,
          // ProjectDocSync) which all carry `ui-tap`. audit:responsive cannot
          // see it: this button is on /projects/[id] and the audit visits
          // /projects only.
          className="ui-btn-chip ui-tap gap-1.5 px-3 text-xs"
          title="Make a place for the code with a starter in it, and make this project dispatchable in Control — no account anywhere else needed."
        >
          <Rocket className="h-3.5 w-3.5 text-accent-text" />
          Make a place for the code
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-raised p-3">
          <p className="text-xs text-text-secondary">
            Loki keeps the code for you, seeded with a starter, so an agent can start building. It
            stays yours — take it to your own GitHub any time from Project settings.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="ui-input-compact"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              aria-label="Starter template"
            >
              {PROVISION_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              className="ui-input-compact"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "private" | "public")}
              aria-label="Who can see the code"
            >
              <option value="private">Private</option>
              <option value="public">Public (open source)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={provision} disabled={busy} className="ui-btn-save gap-1.5">
              {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3.5 w-3.5" />}
              Provision
            </button>
            <button onClick={() => setOpen(false)} disabled={busy} className="ui-btn-text-cancel">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}
