"use client";

import { useAiForm } from "@fleet/ai-forms/react";
import {
  VALID_CURRENCIES as CURRENCIES,
  VALID_FREQUENCIES as FREQUENCIES,
  FREQUENCY,
} from "@/config/subscriptions";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { postJson } from "@/lib/api/fetch";
import { SUBSCRIPTION_FORM } from "@/config/ai-forms";
import type { CreateSubscriptionInput } from "@/db/queries/money";
import { DateInput } from "@/components/ui/date-input";

export function NewSubscriptionButton() {
  const form = useAiForm({
    target: SUBSCRIPTION_FORM.key,
    fields: SUBSCRIPTION_FORM.fields,
    // Defaults, not user intent — both are marked overridable so "…billed
    // yearly in dollars" can replace them on a fill.
    initialValues: { currency: "CHF", frequency: FREQUENCY.MONTHLY },
  });
  const { create, saving, error, setError } = useCreateMutation<CreateSubscriptionInput>({
    request: (body) => postJson("/api/subscriptions", body),
    errorLabel: "subscription",
  });

  const onReset = () => {
    form.reset();
    setError(null);
  };

  const amount = form.text("amount");
  const onSubmit = () =>
    create({
      name: form.text("name").trim(),
      vendor: form.text("vendor").trim() || undefined,
      amount: amount ? parseFloat(amount) : undefined,
      currency: form.text("currency") as (typeof CURRENCIES)[number],
      frequency: form.text("frequency") as (typeof FREQUENCIES)[number],
      nextDue: form.text("nextDue") || undefined,
      paymentMethod: form.text("paymentMethod").trim() || undefined,
      notes: form.text("notes").trim() || undefined,
    });

  return (
    <ModalForm
      title="Add Subscription"
      submitLabel="Add Subscription"
      savingLabel="Adding…"
      size="md"
      canSubmit={!!form.text("name").trim()}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
      assist={form}
      assistPlaceholder="e.g. Copilot, 19 dollars a month on the Visa…"
    >
      <Field label="Name" required aiTouched={form.isAiTouched("name")}>
        <input
          value={form.text("name")}
          onChange={(e) => form.setValue("name", e.target.value)}
          placeholder="e.g. GitHub Copilot"
          autoFocus
          className="ui-input"
        />
      </Field>

      <Field label="Vendor" aiTouched={form.isAiTouched("vendor")}>
        <input
          value={form.text("vendor")}
          onChange={(e) => form.setValue("vendor", e.target.value)}
          placeholder="e.g. GitHub Inc."
          className="ui-input"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" aiTouched={form.isAiTouched("amount")}>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => form.setValue("amount", e.target.value)}
            placeholder="0.00"
            className="ui-input"
          />
        </Field>
        <Field label="Currency" aiTouched={form.isAiTouched("currency")}>
          <select
            value={form.text("currency")}
            onChange={(e) => form.setValue("currency", e.target.value)}
            className="ui-input"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Frequency" aiTouched={form.isAiTouched("frequency")}>
          <select
            value={form.text("frequency")}
            onChange={(e) => form.setValue("frequency", e.target.value)}
            className="ui-input"
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Next Due" aiTouched={form.isAiTouched("nextDue")}>
          <DateInput
            type="date"
            value={form.text("nextDue")}
            onChange={(e) => form.setValue("nextDue", e.target.value)}
            className="ui-input"
          />
        </Field>
      </div>

      <Field label="Payment Method" aiTouched={form.isAiTouched("paymentMethod")}>
        <input
          value={form.text("paymentMethod")}
          onChange={(e) => form.setValue("paymentMethod", e.target.value)}
          placeholder="e.g. Visa ····1234"
          className="ui-input"
        />
      </Field>

      <Field label="Notes" aiTouched={form.isAiTouched("notes")}>
        <input
          value={form.text("notes")}
          onChange={(e) => form.setValue("notes", e.target.value)}
          placeholder="Optional notes"
          className="ui-input"
        />
      </Field>
    </ModalForm>
  );
}
