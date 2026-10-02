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
