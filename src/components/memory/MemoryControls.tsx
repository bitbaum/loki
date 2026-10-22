"use client";

/**
 * Client-side mutation controls for the Memory page (data controls).
 *
 * - MemoryEntityList: the "Recently added" rows, each with its own `…` menu
 *   holding Forget (a two-step confirm inside the menu, via DeleteButton).
 * - ForgetAllMemory: guarded "forget everything" — wipes the knowledge graph
 *   AND the RAG index via DELETE /api/memory?all=true. The last row of the
 *   page, quiet until pressed, red only once it asks to be confirmed.
 *
 * Both refresh the server-rendered page after a successful delete so the
 * counts stay truthful.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteJson, throwApiError } from "@/lib/api/fetch";
import { DeleteButton } from "@/components/ui/delete-button";
import { List, ListRow } from "@/components/ui/list-row";
import { RowActions } from "@/components/ui/row-actions";
import { compactRelativeDate } from "@/lib/dates";
import { memoryKind } from "@/config/memory";

type RecentEntity = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  createdAt: Date | string;
};

export function MemoryEntityList({ entities }: { entities: RecentEntity[] }) {
  const router = useRouter();
  return (
    <List aria-label="Recently added">
      {entities.map((e) => {
        const kind = memoryKind(e.type);
        return (
          <ListRow
            key={e.id}
            icon={kind.icon}
            title={e.name}
            secondary={e.description ? `${kind.label} · ${e.description}` : kind.label}
            trailing={compactRelativeDate(e.createdAt)}
            menu={
              <RowActions label={`More for ${e.name}`}>
                {/* The confirm answers in place, so its clicks must not close
                    the menu (RowActions' note). */}
                <span onClick={(ev) => ev.stopPropagation()}>
                  <DeleteButton
                    label="Forget?"
                    triggerTitle={`Forget ${e.name}`}
                    triggerLabel="Forget"
                    triggerClassName="ui-menu-item justify-start"
                    onDelete={async () => {
                      const res = await deleteJson(`/api/memory/entities/${e.id}`);
                      if (!res.ok) await throwApiError(res, "Could not forget that");
                      router.refresh();
                    }}
                  />
                </span>
              </RowActions>
            }
          />
        );
      })}
    </List>
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
      if (!res.ok) await throwApiError(res, "Could not forget everything");
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not forget everything");
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <List aria-label="Forget">
        <ListRow icon={Trash2} title="Forget everything" onClick={() => setConfirming(true)} />
      </List>
    );
  }

  return (
    <div className="space-y-3">
      {/* "knowledge graph and RAG index" named two internals for one thing
          the reader knows by a different name: everything Loki remembers. */}
      <p className="text-sm text-status-negative">
        Erase everything Loki remembers — every person, project and connection. No undo.
      </p>
      <div className="flex items-center gap-2">
        <button onClick={forgetAll} disabled={busy} className="ui-btn-danger">
          {busy ? <Loader2 className="ui-spinner-xs" /> : "Yes, forget all"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          className="ui-btn-ghost"
        >
          Cancel
        </button>
      </div>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}
