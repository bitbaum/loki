"use client";

import { useAiForm } from "@fleet/ai-forms/react";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { ASSIGNMENT_FORM } from "@/config/ai-forms";
import { TASK_CURRENCIES, type CreateHumanTaskInput } from "@/config/crew";
import type { CrewMember } from "@/db/queries/crew";
import { DateInput } from "@/components/ui/date-input";

export type ProjectOption = { id: string; name: string };

/**
 * Write an ask. Nothing is sent from here — a new assignment is a DRAFT, and
 * handing it over is a separate, deliberate click on the board. That is why
 * this form has no "send" and no assignee requirement: you can write the work
 * down before you know who is doing it.
 */
export function NewAssignmentButton({
  crew,
  projects,
  defaultAssigneeId,
  defaultOpen,
  triggerLabel,
  onCreated,
}: {
  crew: CrewMember[];
  projects: ProjectOption[];
  defaultAssigneeId?: string;
  /** Opens straight into the form — used by the roster's "Assign work". */
  defaultOpen?: boolean;
  triggerLabel?: string;
  onCreated?: () => void;
}) {
  const form = useAiForm({
    target: ASSIGNMENT_FORM.key,
    fields: ASSIGNMENT_FORM.fields,
    initialValues: {
      feeCurrency: TASK_CURRENCIES[0],
      ...(defaultAssigneeId ? { assigneeId: defaultAssigneeId } : {}),
    },
  });
  const { create, saving, error, setError } = useCreateMutation<CreateHumanTaskInput>({
    request: (body) => postJson("/api/crew/tasks", body),
    errorLabel: "assignment",
  });

  const onReset = () => {
    form.reset();
    setError(null);
  };

  const onSubmit = async () => {
    const rawFee = form.text("feeAmount").trim();
    const fee = rawFee ? Number(rawFee) : undefined;
    const ok = await create({
      title: form.text("title").trim(),
      brief: form.text("brief").trim() || undefined,
      reason: form.text("reason").trim() || undefined,
      assigneeId: form.text("assigneeId") || undefined,
      projectId: form.text("projectId") || undefined,
      dueDate: form.text("dueDate") || undefined,
      feeAmount: fee !== undefined && Number.isFinite(fee) ? fee : undefined,
      feeCurrency:
        fee !== undefined && Number.isFinite(fee)
          ? (form.text("feeCurrency") as CreateHumanTaskInput["feeCurrency"])
          : undefined,
    });
    if (ok) onCreated?.();
    return ok;
  };

  return (
    <ModalForm
      triggerLabel={triggerLabel ?? "New assignment"}
      title="Assign work to a human"
      defaultOpen={defaultOpen}
      submitLabel="Save as draft"
      savingLabel="Saving…"
      size="md"
      canSubmit={form.text("title").trim().length >= 3}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="Describe the work in plain language — I'll write the brief…"
    >
      <Field label="Ask" required aiTouched={form.isAiTouched("title")}>
        <input
          value={form.text("title")}
          onChange={(e) => form.setValue("title", e.target.value)}
          placeholder="e.g. Contact the three Basel suppliers"
          autoFocus
          className="ui-input"
        />
      </Field>

      <Field label="Brief — what to do, written for them" aiTouched={form.isAiTouched("brief")}>
        <textarea
          value={form.text("brief")}
          onChange={(e) => form.setValue("brief", e.target.value)}
          rows={5}
          placeholder="Who to contact, what to say, what to bring back."
          className="ui-input"
        />
      </Field>

      <Field label="Why — the half that earns a yes" aiTouched={form.isAiTouched("reason")}>
        <textarea
          value={form.text("reason")}
          onChange={(e) => form.setValue("reason", e.target.value)}
          rows={3}
          placeholder="e.g. We need a second quote before the board meeting."
          className="ui-input"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Who">
          <select
            value={form.text("assigneeId")}
            onChange={(e) => form.setValue("assigneeId", e.target.value)}
            className="ui-input"
          >
            <option value="">Nobody yet</option>
            {crew.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.role ? ` — ${member.role}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project">
          <select
            value={form.text("projectId")}
            onChange={(e) => form.setValue("projectId", e.target.value)}
            className="ui-input"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Needed by" aiTouched={form.isAiTouched("dueDate")}>
          <DateInput
            type="date"
            value={form.text("dueDate")}
            onChange={(e) => form.setValue("dueDate", e.target.value)}
            className="ui-input"
          />
        </Field>
        <Field label="Fee" aiTouched={form.isAiTouched("feeAmount")}>
          <input
            type="number"
            min={0}
            // Satoshi-precision: the browser's default step of 1 rejects
            // 0.0005 BTC outright, which is most of the point of BTC here.
            step="any"
            value={form.text("feeAmount")}
            onChange={(e) => form.setValue("feeAmount", e.target.value)}
            placeholder="0"
            className="ui-input"
          />
        </Field>
        <Field label="Currency" aiTouched={form.isAiTouched("feeCurrency")}>
          <select
            value={form.text("feeCurrency") || TASK_CURRENCIES[0]}
            onChange={(e) => form.setValue("feeCurrency", e.target.value)}
            className="ui-input"
          >
            {TASK_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </ModalForm>
  );
}
