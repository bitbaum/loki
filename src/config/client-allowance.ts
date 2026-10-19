/**
 * How many changes a month a project's client may have built without the
 * owner — the owner's choice per client, on the project's People panel.
 *
 * The client is the person a site is for. Before this, everything they asked
 * waited for the owner, so the owner was the bottleneck on every client's
 * every word; the only alternative was making them a Builder, whose asks
 * build at once, without limit, and go live without anyone looking. This is
 * the seat between: their asks build at once up to the number chosen here,
 * each change waits for THEIR "Make it live", and past the number the owner
 * decides (owner, 2026-10-19).
 *
 * `null` is "Ask me first": nothing builds without the owner's tap.
 */
export const CLIENT_ALLOWANCE_CHOICES = [
  {
    id: "ask",
    value: null,
    label: "Ask me",
    means: "Everything they ask comes to you first. You decide what gets built.",
  },
  {
    id: "5",
    value: 5,
    label: "5",
    means: "Up to 5 changes a month build at once. Past that, you decide.",
  },
  {
    id: "20",
    value: 20,
    label: "20",
    means: "Up to 20 changes a month build at once. Past that, you decide.",
  },
  {
    id: "50",
    value: 50,
    label: "50",
    means: "Up to 50 changes a month build at once. Past that, you decide.",
  },
] as const;

export type ClientAllowance = (typeof CLIENT_ALLOWANCE_CHOICES)[number]["value"];

/** What a new client is given unless the owner picks otherwise. */
export const DEFAULT_CLIENT_ALLOWANCE: ClientAllowance = 20;

export const CLIENT_ALLOWANCE_VALUES: readonly number[] = CLIENT_ALLOWANCE_CHOICES.flatMap((c) =>
  c.value === null ? [] : [c.value],
);

export function allowanceChoiceId(value: number | null | undefined): string {
  return CLIENT_ALLOWANCE_CHOICES.find((c) => c.value === (value ?? null))?.id ?? "ask";
}

/** The month an allowance is counted in: from the first of the month, UTC. */
export function allowanceMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Changes left this month, or null when the client has no allowance. */
export function changesLeft(limit: number | null | undefined, used: number): number | null {
  if (!limit || limit <= 0) return null;
  return Math.max(0, limit - used);
}
