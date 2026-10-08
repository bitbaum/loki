"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Pencil, X, Check, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { FulfillCommitmentButton } from "./FulfillCommitmentButton";
import { DeleteButton } from "@/components/ui/delete-button";
import { patchJson, deleteJson, throwApiError } from "@/lib/api/fetch";
import { deadlineLabel } from "@/lib/dates";
import { DateInput } from "@/components/ui/date-input";

type CommitmentItemProps = {
  id: string;
  description: string;
  dueDate: Date | null;
  financialImpact: string | null;
};

export function CommitmentItem({ id, description, dueDate, financialImpact }: CommitmentItemProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(description);
  const [date, setDate] = useState(dueDate ? format(new Date(dueDate), "yyyy-MM-dd") : "");
  const [impact, setImpact] = useState(financialImpact ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { label: deadline, overdue: isOverdue } = deadlineLabel(dueDate);

  const save = async () => {
    if (!desc.trim()) {
      setError("Description required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await patchJson(`/api/commitments/${id}`, {
        description: desc,
        dueDate: date || null,
        financialImpact: impact || null,
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDesc(description);
    setDate(dueDate ? format(new Date(dueDate), "yyyy-MM-dd") : "");
    setImpact(financialImpact ?? "");
    setError("");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex gap-3 items-start">
        <div className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1.5 min-w-0">
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
            }}
            className="ui-input-inline w-full px-2 py-1 text-sm text-text-primary placeholder:text-text-muted"
          />
          <div className="flex gap-1.5">
            <DateInput
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="ui-input-tight"
            />
            <input
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="Financial impact"
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
              className="flex-1 ui-input-tight"
            />
          </div>
          {error && <p className="ui-error-xs">{error}</p>}
          <div className="flex gap-1.5">
            <button onClick={save} disabled={saving || !desc.trim()} className="ui-btn-confirm-sm">
              {saving ? <Loader2 className="ui-spinner-xs" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button onClick={cancel} className="flex items-center gap-1 ui-link-muted">
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 items-start">
      {isOverdue ? (
        <AlertCircle className="h-4 w-4 text-status-negative shrink-0 mt-0.5" />
      ) : (
        <div className="h-4 w-4 rounded-full border border-border-strong shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm md:text-base">{description}</div>
        {dueDate && (
          <div
            className={`text-xs md:text-sm ${isOverdue ? "text-status-negative" : "text-text-tertiary"}`}
          >
            {deadline}
          </div>
        )}
        {financialImpact && (
          <div className="text-xs md:text-sm text-status-warning/70">{financialImpact}</div>
        )}
      </div>
      <FulfillCommitmentButton commitmentId={id} />
      <div className="flex gap-0.5 shrink-0 ui-hover-reveal transition-opacity">
        <button
          onClick={() => setEditing(true)}
          title="Edit commitment"
          aria-label="Edit commitment"
          className="ui-btn-row-action"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <DeleteButton
          onDelete={async () => {
            const res = await deleteJson(`/api/commitments/${id}`);
            if (!res.ok) await throwApiError(res, "Failed to delete");
            router.refresh();
          }}
          triggerTitle="Remove commitment"
          triggerClassName="p-1 rounded text-text-muted hover:text-status-negative/70 transition-colors shrink-0"
        />
      </div>
    </div>
  );
}
