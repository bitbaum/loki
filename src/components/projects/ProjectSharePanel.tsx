"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Share2, X } from "lucide-react";
import { deleteJson, postJson, throwApiError } from "@/lib/api/fetch";
import { useClipboard } from "@/hooks/use-clipboard";
import { Modal } from "@/components/ui/modal";

type ShareSettings = {
  audience: "advisor" | "team" | "public";
  includeRoadmap: boolean;
  includeChangelog: boolean;
  includeResources: boolean;
  includeRepo: boolean;
  includeLiveUrl: boolean;
};

type ExistingShare = ShareSettings & {
  token: string;
  url: string;
};

const DEFAULTS: ShareSettings = {
  audience: "advisor",
  includeRoadmap: true,
  includeChangelog: true,
  includeResources: true,
  includeRepo: false,
  includeLiveUrl: true,
};

export function ProjectSharePanel({
  projectId,
  initialShare,
}: {
  projectId: string;
  initialShare: ExistingShare | null;
}) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<ExistingShare | null>(initialShare);
  const [settings, setSettings] = useState<ShareSettings>(() => initialShare ?? DEFAULTS);
  const [busy, setBusy] = useState(false);
  // Custom 1400ms reset — matches this panel's pre-existing feedback duration
  // (not one of the named timing constants).
  const { copied, copy } = useClipboard(1400);
  const [error, setError] = useState<string | null>(null);
  const hasShare = Boolean(share);

  const includeCount = useMemo(
    () =>
      [
        settings.includeRoadmap,
        settings.includeChangelog,
        settings.includeResources,
        settings.includeRepo,
        settings.includeLiveUrl,
      ].filter(Boolean).length,
    [settings],
  );

  async function saveShare() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/share`, settings);
      if (!res.ok) await throwApiError(res, "Failed to create share link");
      const json = (await res.json()) as { share: ExistingShare };
      setShare(json.share);
      setSettings(json.share);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create share link");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteJson(`/api/projects/${projectId}/share`);
      if (!res.ok) await throwApiError(res, "Failed to revoke share link");
      setShare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke share link");
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!share?.url) return;
    const url = share.url.startsWith("http") ? share.url : `${window.location.origin}${share.url}`;
    copy(url);
  }

  return (
    <div className="relative">
      {/* Ghost, like every other control in the project header — see the note
          on the action row in ProjectWorkspaceView. As the one bordered button
          in that row it read as the page's primary action, which it is not. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-btn-ghost min-h-11 gap-1.5"
      >
        <Share2 className="h-3.5 w-3.5" />
        {hasShare ? "Shared" : "Share"}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="project-share-title">
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 id="project-share-title" className="ui-project-section-title">
                Share project
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                Unlisted, read-only, and filtered. Internal controls, private notes, and credential
                values stay out.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ui-icon-btn"
              aria-label="Close share panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            <select
              autoFocus
              value={settings.audience}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  audience: e.target.value as ShareSettings["audience"],
                }))
              }
              className="ui-input-tight w-full"
              aria-label="Audience"
            >
              <option value="advisor">Advisor / reviewer</option>
              <option value="team">Team collaborator</option>
              <option value="public">Public read-only</option>
            </select>
            {[
              ["includeLiveUrl", "Live link"],
              ["includeRoadmap", "Roadmap"],
              ["includeChangelog", "Changelog"],
              ["includeResources", "Resources"],
              ["includeRepo", "Repository link"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex min-h-11 items-center gap-3 text-sm text-text-secondary"
              >
                <input
                  type="checkbox"
                  checked={Boolean(settings[key as keyof ShareSettings])}
                  onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveShare}
              disabled={busy}
              className="ui-btn-save min-h-11 gap-1.5"
            >
              {busy ? <Loader2 className="ui-spinner-xs" /> : <Share2 className="h-3.5 w-3.5" />}
              {share ? `Update (${includeCount})` : "Create link"}
            </button>
            {share && (
              <>
                <button
                  type="button"
                  onClick={copyLink}
                  className="ui-btn-secondary min-h-11 gap-1.5"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={share.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-btn-secondary min-h-11 gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
                <button
                  type="button"
                  onClick={revoke}
                  disabled={busy}
                  className="ui-btn-danger min-h-11"
                >
                  Revoke
                </button>
              </>
            )}
          </div>
          {share && <p className="mt-2 truncate text-xs text-text-tertiary">{share.url}</p>}
          {error && <p className="mt-2 ui-error-xs">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
