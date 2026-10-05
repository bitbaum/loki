"use client";

/**
 * Client-side mutation controls for the Memory page (data controls).
 *
 * - MemoryEntityList: the "Recently Added" list with a per-entity forget
 *   button (two-step inline confirm via DeleteButton).
 * - ForgetAllMemory: guarded "forget everything" — wipes the knowledge graph
 *   AND the RAG index via DELETE /api/memory?all=true.
 *
 * Both refresh the server-rendered page after a successful delete so the stat
 * cards and distribution bars stay truthful.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { deleteJson, throwApiError } from "@/lib/api/fetch";
import { DeleteButton } from "@/components/ui/delete-button";
import { EmptyState } from "@/components/ui/empty-state";
import { compactRelativeDate } from "@/lib/dates";
import type { EntityType } from "@/lib/constants/statuses";

type RecentEntity = {
  id: string;
  name: string;
  type: EntityType;
  description: string | null;
  createdAt: Date | string;
  /** Precomputed on the server (TYPE_COLOR is the page's SSOT) — functions can't cross the RSC boundary. */
  badgeClass: string;
};

export function MemoryEntityList({ entities }: { entities: RecentEntity[] }) {
  const router = useRouter();

  if (entities.length === 0) {
    return <EmptyState>Nothing added yet</EmptyState>;
  }

  return (
    <div className="space-y-2">
      {entities.map((e) => (
        <div key={e.id} className="flex items-start gap-2.5">
          <span className={`ui-tag ${e.badgeClass}`}>{e.type}</span>
          <div className="flex-1 min-w-0">
            <div className="text-base truncate text-text-primary">{e.name}</div>
            {e.description && (
              <div className="mt-1 line-clamp-2 text-sm text-text-secondary">{e.description}</div>
            )}
          </div>
          <span className="shrink-0 pt-0.5 text-xs text-text-tertiary">
            {compactRelativeDate(e.createdAt)}
          </span>
          <DeleteButton
            label="Forget?"
            triggerTitle="Forget this entity"
            onDelete={async () => {
              const res = await deleteJson(`/api/memory/entities/${e.id}`);
              if (!res.ok) await throwApiError(res, "Failed to forget entity");
              router.refresh();
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function ForgetAllMemory() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forgetAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteJson("/api/memory?all=true");
      if (!res.ok) await throwApiError(res, "Failed to forget memory");
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to forget memory");
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      // inline-flex, not a bare inline link: min-h is inert on an inline box,
      // so this irreversible action was a 14px-tall tap target.
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex min-h-11 shrink-0 items-center text-xs text-text-muted underline hover:text-status-negative"
      >
        Forget everything
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* "knowledge graph and RAG index" named two internals for one thing
          the reader knows by a different name: everything Loki remembers. */}
      <span className="text-xs text-status-negative">
        Erase everything Loki remembers — every person, project and connection. No undo.
      </span>
      <button
        onClick={forgetAll}
        disabled={busy}
        className="text-xs text-status-negative px-1 disabled:opacity-50"
      >
        {busy ? <Loader2 className="ui-spinner-xs" /> : "Yes, forget all"}
      </button>
      <button
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        className="ui-btn-text-cancel"
      >
        Cancel
      </button>
      {error && <span className="ui-error-xs">{error}</span>}
    </div>
  );
}
