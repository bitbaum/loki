/**
 * How the owner wants things built — product decisions that hold on EVERY
 * project, written once so nobody has to repeat them to an agent.
 *
 * Operating principles (operating-principles.ts) say how code is written;
 * these say what a person using the result should find. Both travel with every
 * dispatch (renderOperatingPrinciples), and the site widget's advisor reads
 * these too, so Loki judges a site by the same rules its builder was given.
 *
 * WHY: "I assume you know what I like — that is why we have packages — and I
 * should not have to tell you every time" (operator, 2026-10-15, after a form
 * on a client site shipped a description field with no microphone). A rule
 * that lives only in someone's head is re-learnt one site at a time.
 *
 * Each rule is a default, not an absolute: name what it applies to and what it
 * does not, so an agent can tell the difference.
 */
export type BuildConvention = {
  /** Stable key — tests and later per-project overrides refer to it. */
  id: string;
  /** One sentence an agent can act on and a person can check. */
  rule: string;
};

export const BUILD_CONVENTIONS: readonly BuildConvention[] = [
  {
    id: "voice-where-people-describe",
    rule: "A field where someone writes in their own words (a description, message, notes, feedback) gets a microphone so they can speak instead of type; short fields (name, email, date, number) never do, and a form that has an AI fill bar keeps its one microphone there instead. Take the microphone from @bitbaum/chatkit (useDictation, or its Composer for a message box), never a recorder of your own.",
  },
  {
    id: "fleet-packages-first",
    rule: "When a fleet package already does what a part of the site needs (sign-in, search, chat, forms, payments, booking, mail), the site uses that package; if it cannot, say so in the handoff instead of writing a replacement.",
  },
] as const;

/** The block an agent or the advisor reads. */
export function renderBuildConventions(): string {
  return [
    "How the owner wants things built (every project, unless the brief says otherwise):",
    ...BUILD_CONVENTIONS.map((c) => `- ${c.rule}`),
  ].join("\n");
}
