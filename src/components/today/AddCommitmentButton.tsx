"use client";

import { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import type { CreateCommitmentInput } from "@/db/queries/today";
import { DateInput } from "@/components/ui/date-input";

export function AddCommitmentButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [financialImpact, setFinancialImpact] = useState("");
  const { create, saving, error, setError } = useCreateMutation<CreateCommitmentInput>({
    request: (body) => postJson("/api/commitments", body),
    errorLabel: "commitment",
  });

  const reset = () => {
    setDescription("");
    setDueDate("");
    setFinancialImpact("");
    setError(null);
  };

  const submit = async () => {
    if (!description.trim()) {
      setError("Description is required");
      return;
    }
    const ok = await create({
      description,
      dueDate: dueDate || undefined,
      financialImpact: financialImpact || undefined,
    });
    if (ok) {
      reset();
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ui-btn-add-success mt-2">
        <Plus className="h-3.5 w-3.5" /> Add commitment
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle space-y-2">
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What did you commit to? *"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            reset();
          }
        }}
        className="w-full ui-input-compact"
      />
      <div className="flex gap-2">
        <DateInput
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="ui-input-compact"
        />
        <input
          value={financialImpact}
          onChange={(e) => setFinancialImpact(e.target.value)}
          placeholder="Financial impact (optional)"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setOpen(false);
              reset();
            }
          }}
          className="flex-1 ui-input-compact"
        />
      </div>
      {error && <p className="ui-error-xs">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving || !description.trim()}
          className="ui-btn-confirm-sm"
        >
          {saving ? <Loader2 className="ui-spinner-xs" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="flex items-center gap-1 ui-link-muted"
        >
          <X className="h-3 w-3" /> Cancel
        </button>
      </div>
    </div>
  );
}
