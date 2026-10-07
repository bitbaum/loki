/** Bitbaum owns engagement terms. Loki consumes the published view. */
export const COMMISSION = {
  path: "/change",
  submitPath: "/api/commission",
  buildPath: "/api/projects/from-website",
  studioOrigin: "https://bitbaum.orangecat.ch",
  studioContractUrl: "https://bitbaum.orangecat.ch/commission.json",
  studioHireUrl: "https://bitbaum.orangecat.ch/hire/",
  draftKey: "loki:website-brief:v1",
  maxWebsite: 500,
  maxChanges: 1200,
} as const;

/**
 * What a person can do with a website address on /change. SSOT for the label,
 * the button, the reassurance line and the repo-name suffix of each mode.
 *
 * - refresh: a new version OF that site, for its owner — brand and content kept.
 *   The address alone starts a free consultation (config/site-consult) before
 *   anything is built; its findings become fixes the owner keeps or drops.
 * - inspired: a new, independent site that only borrows ideas from it — layout,
 *   structure, interaction, mood. Its name, logo, words, pictures and code stay
 *   theirs; the result is the asker's own and must not pass for the original.
 */
export const WEBSITE_MODES = {
  refresh: {
    label: "Improve this site",
    changesLabel: "What should change",
    action: "Build a new version",
    note: "Your live site is not touched — you review the new version first.",
    nameSuffix: "refresh",
    placeholder:
      "Your website, e.g. “my-bakery.ch” — Loki looks at it first and tells you what it finds.",
  },
  inspired: {
    label: "Make my own, inspired by it",
    changesLabel: "What yours is for",
    action: "Build my own site",
    note: "Ideas only — their name, logo, words and pictures are not copied.",
    nameSuffix: "inspired",
    placeholder:
      "e.g. “I love how stripe.com feels — make me something like it for my pottery studio.”",
  },
} as const;

export type WebsiteMode = keyof typeof WEBSITE_MODES;
export const WEBSITE_MODE_IDS = Object.keys(WEBSITE_MODES) as [WebsiteMode, ...WebsiteMode[]];
