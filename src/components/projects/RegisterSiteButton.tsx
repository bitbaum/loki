"use client";

import { useState } from "react";
import { Loader2, Server } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { useSiteDeployment } from "@/hooks/use-site-deployment";
import { SiteDeploymentStatus } from "./SiteDeploymentStatus";

/**
 * Idempotent retry for Hetzner CD registration after kickoff left a repo
 * without a live URL (command-only / missing key / script failed).
 * POSTs /api/projects/[id]/register-cd — never invents a liveUrl.
 */
export function RegisterSiteButton({
  projectId,
  hasRepo,
  liveUrl,
  template = "nextjs-tailwind",
}: {
  projectId: string;
  hasRepo: boolean;
  liveUrl: string | null | undefined;
  template?: "nextjs-tailwind" | "bare";
}) {
  const { deployment, setDeployment } = useSiteDeployment(projectId, hasRepo && !liveUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasRepo || liveUrl) return null;

  async function run() {
    setBusy(true);
    setError(null);

    try {
      const res = await postJson(`/api/projects/${projectId}/register-cd`, { template });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
        return;
      }
      setDeployment(json);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ui-btn-ghost min-h-11 gap-1.5"
        onClick={() => void run()}
        disabled={busy}
        title="Set up or retry this project’s site deployment"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Server className="h-4 w-4" aria-hidden="true" />
        )}
        {busy ? "Registering…" : "Register site"}
      </button>
      {/* Full-width status under the action row (basis-full in a flex-wrap
          parent). Nesting the sentence + "Check deployment" inside the same
          ghost control made Registering… read as a third peer of Repository
          and Share. */}
      {(deployment || error) && (
        <div className="basis-full w-full max-w-xl space-y-1">
          <SiteDeploymentStatus deployment={deployment} />
          {error && <span className="ui-error text-xs">{error}</span>}
        </div>
      )}
    </>
  );
}
