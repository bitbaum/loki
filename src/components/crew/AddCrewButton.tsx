"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui/form";
import { ModalForm } from "@/components/ui/modal-form";
import { useCreateMutation } from "@/hooks/use-create-mutation";
import { getJson, postJson } from "@/lib/api/fetch";
import {
  ENGAGEMENT,
  ENGAGEMENTS,
  ENGAGEMENT_LABEL,
  TASK_CURRENCIES,
  type EnrolCrewInput,
} from "@/config/crew";

type PersonOption = { id: string; name: string };

/**
 * Put someone in the loop — either a contact you already have, or a new name.
 *
 * The people picker loads lazily, when the modal is first opened: a book with
 * hundreds of contacts should not be paid for by everyone who visits the page.
 */
export function AddCrewButton({
  onCreated,
  trigger = "secondary",
  triggerLabel = "Add someone",
}: {
  onCreated?: () => void;
  trigger?: "button" | "secondary";
  triggerLabel?: string;
}) {
  const [name, setName] = useState("");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("");
  const [skills, setSkills] = useState("");
  const [engagement, setEngagement] = useState<string>(ENGAGEMENT.FREELANCE);
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState<string>(TASK_CURRENCIES[0]);
  const [availability, setAvailability] = useState("");
  const [orangecatProfile, setOrangecatProfile] = useState("");
  const [people, setPeople] = useState<PersonOption[] | null>(null);

  useEffect(() => {
    if (people) return;
    getJson<{ people: PersonOption[] }>("/api/people?limit=200")
      .then((data) => setPeople(data.people.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setPeople([]));
  }, [people]);

  const { create, saving, error, setError } = useCreateMutation<EnrolCrewInput>({
    request: (body) => postJson("/api/crew", body),
    errorLabel: "crew member",
  });

  const onReset = () => {
    setName("");
    setPersonId("");
    setRole("");
    setSkills("");
    setEngagement(ENGAGEMENT.FREELANCE);
    setRate("");
    setCurrency(TASK_CURRENCIES[0]);
    setAvailability("");
    setOrangecatProfile("");
    setError(null);
  };

  const onSubmit = async () => {
    const ok = await create({
      personId: personId || undefined,
      name: personId ? undefined : name.trim() || undefined,
      role: role.trim() || undefined,
      skills: skills.trim() || undefined,
      engagement: engagement as EnrolCrewInput["engagement"],
      rate: rate.trim() || undefined,
      currency: currency as EnrolCrewInput["currency"],
      availability: availability.trim() || undefined,
      orangecatProfile: orangecatProfile.trim() || undefined,
    });
    if (ok) onCreated?.();
    return ok;
  };

  return (
    <ModalForm
      trigger={trigger}
      triggerLabel={triggerLabel}
      title="Add someone to your crew"
      submitLabel="Add to crew"
      savingLabel="Adding…"
      canSubmit={Boolean(personId) || name.trim().length > 0}
      saving={saving}
      error={error}
      onSubmit={onSubmit}
      onReset={onReset}
    >
      <Field label="From your people book">
        <select value={personId} onChange={(e) => setPersonId(e.target.value)} className="ui-input">
          <option value="">Someone new…</option>
          {(people ?? []).map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </Field>

      {!personId && (
        <Field label="Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jana Roth"
            className="ui-input"
          />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Role">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Trade lawyer"
            className="ui-input"
          />
        </Field>
        <Field label="How you work together">
          <select
            value={engagement}
            onChange={(e) => setEngagement(e.target.value)}
            className="ui-input"
          >
            {ENGAGEMENTS.map((value) => (
              <option key={value} value={value}>
                {ENGAGEMENT_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="What they're good for — comma separated">
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="e.g. supplier calls, contracts, German"
          className="ui-input"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Rate">
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 120/hour"
            className="ui-input"
          />
        </Field>
        <Field label="Currency">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="ui-input"
          >
            {TASK_CURRENCIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Availability">
          <input
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            placeholder="e.g. evenings"
            className="ui-input"
          />
        </Field>
      </div>

      <Field label="OrangeCat profile — where they get paid in BTC">
        <input
          value={orangecatProfile}
          onChange={(e) => setOrangecatProfile(e.target.value)}
          placeholder="their handle, or https://orangecat.ch/profiles/…"
          className="ui-input"
        />
      </Field>
    </ModalForm>
  );
}
