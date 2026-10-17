/**
 * First builds for someone with nothing registered yet.
 *
 * The suggestion row on /loki is ranked from a person's own records — their
 * projects, the reports on them, their goals, their notes, the open demand on
 * OrangeCat. A brand-new account has none of that, and an empty row teaches
 * them nothing about what this place is for. These are the fallback: small,
 * finishable first versions that each end in something live, so the first
 * thing Loki builds for a person is something they can open on their phone.
 *
 * Structure only — the ranker decides when they show.
 */
export type BuildStarter = {
  id: string;
  /** Chip text. Short enough for a 390px row. */
  label: string;
  /** Project name the create dialog is prefilled with. */
  name: string;
  /** What the first version is — becomes the project description. */
  description: string;
  /**
   * The card's one line, to the person. Each starter says what IT is: the row
   * used to give all four the same sentence ("A first build that ends in
   * something live"), four times down one page (seen 2026-10-17).
   */
  why: string;
};

export const BUILD_STARTERS: readonly BuildStarter[] = [
  {
    id: "personal-site",
    label: "Your own site",
    name: "my-site",
    description:
      "A one-page personal site: who I am, what I do, how to reach me. Live on its own URL, editable by talking to it.",
    why: "One page: who you are, what you do, how to reach you.",
  },
  {
    id: "offer-page",
    label: "A page for your offer",
    name: "offer",
    description:
      "A landing page for one thing I sell or offer, with a clear price and one way to say yes.",
    why: "One thing you sell, its price, and one way to say yes.",
  },
  {
    id: "booking",
    label: "Booking page",
    name: "booking",
    description: "A simple page where people pick a time with me and leave their contact.",
    why: "People pick a time with you and leave their contact.",
  },
  {
    id: "small-tool",
    label: "A tool you keep wishing for",
    name: "tool",
    description:
      "A small web tool for one chore I repeat every week — the first version does exactly one thing well.",
    why: "A small web tool for one chore you repeat every week.",
  },
] as const;
