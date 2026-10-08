"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { VALID_CURRENCIES, VALID_FREQUENCIES, FREQUENCY } from "@/config/subscriptions";
import { DateInput } from "@/components/ui/date-input";

type EditData = {
  name: string;
  vendor: string;
  amount: string;
  currency: string;
  frequency: string;
  nextDue: string;
  notes: string;
  paymentMethod: string;
};

export function SubscriptionEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: {
    name: string;
    vendor?: string | null;
    amount?: number | null;
    currency?: string | null;
    frequency?: string | null;
    nextDue?: string | null;
    notes?: string | null;
    paymentMethod?: string | null;
  };
  onSave: (data: EditData) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [vendor, setVendor] = useState(initial.vendor ?? "");
  const [amount, setAmount] = useState(initial.amount != null ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(initial.currency ?? "CHF");
  const [frequency, setFrequency] = useState(initial.frequency ?? FREQUENCY.MONTHLY);
  const [nextDue, setNextDue] = useState(initial.nextDue?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [paymentMethod, setPaymentMethod] = useState(initial.paymentMethod ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({ name, vendor, amount, currency, frequency, nextDue, notes, paymentMethod });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full mt-1 p-2.5 rounded bg-surface-base border border-border-subtle space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="w-full ui-input-tight"
      />
      <input
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
        placeholder="Vendor (optional)"
        className="w-full ui-input-tight"
      />
      <div className="flex gap-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="w-24 ui-input-tight"
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="ui-input-tight"
        >
          {VALID_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="flex-1 ui-input-tight"
        >
          {VALID_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 items-center">
        <label className="text-xs text-text-tertiary shrink-0">Next due</label>
        <DateInput
          type="date"
          value={nextDue}
          onChange={(e) => setNextDue(e.target.value)}
          className="flex-1 ui-input-tight"
        />
      </div>
      <input
        value={paymentMethod}
        onChange={(e) => setPaymentMethod(e.target.value)}
        placeholder="Payment method (e.g. Visa ····1234)"
        className="w-full ui-input-tight"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Notes (optional)"
        className="w-full ui-input-tight"
      />
      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving} className="ui-btn-save">
          {saving ? <Loader2 className="ui-spinner-xs" /> : <Save className="h-3 w-3" />}
          Save
        </button>
        <button onClick={onCancel} className="ui-btn-text-cancel">
          Cancel
        </button>
      </div>
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}
