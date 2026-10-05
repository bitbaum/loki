/**
 * "Make it yours" — the open-source projects a person can start their own copy
 * of in one step. SSOT for which repositories /take offers and the API accepts.
 *
 * An allowlist on purpose: the brief tells a builder agent to clone this
 * repository into the person's project, so the source must be one we know is
 * public, MIT-licensed and safe to copy. Adding a project is one entry here.
 *
 * The same set is offered from OrangeCat's /steal page (orangecat
 * src/config/steal.ts), which links here with `?repo=<id>`.
 */

export const OPEN_SOURCE_ORG = "bitbaum";

export const OPEN_SOURCE_STARTERS = {
  orangecat: {
    name: "OrangeCat",
    what: "An AI economic agent and the platform it runs on: payments, funding, loans, groups.",
    needs: "a Supabase project of your own",
  },
  loki: {
    name: "Loki",
    what: "A command centre for building with AI agent fleets.",
    needs: "Postgres with pgvector and a GitHub OAuth app of your own",
  },
  solon: {
    name: "Solon",
    what: "Governance for any group: proposals, signed votes, an append-only audit trail.",
    needs: "a Postgres database of your own",
  },
  evig: {
    name: "evig",
    what: "A storefront, marketplace and repair network for durable hardware.",
    needs: "a Postgres database of your own",
  },
  substrata: {
    name: "Substrata",
    what: "An open research site and engine.",
    needs: "nothing to start",
  },
  heidi: {
    name: "Heidi",
    what: "A speaking-first language tutor.",
    needs: "a Postgres database of your own",
  },
} as const;

export type OpenSourceStarterId = keyof typeof OPEN_SOURCE_STARTERS;
export const OPEN_SOURCE_STARTER_IDS = Object.keys(OPEN_SOURCE_STARTERS) as [
  OpenSourceStarterId,
  ...OpenSourceStarterId[],
];

export const TAKE = {
  path: "/take",
  buildPath: "/api/projects/from-repo",
  draftKey: "loki:take-brief:v1",
  maxWishes: 1200,
} as const;

export const openSourceRepoUrl = (id: OpenSourceStarterId) =>
  `https://github.com/${OPEN_SOURCE_ORG}/${id}`;
