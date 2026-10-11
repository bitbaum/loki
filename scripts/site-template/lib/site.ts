/**
 * What this product is called and where it lives — written once, when the
 * product was created from bitbaum/fleet templates/app, and nowhere else.
 *
 * Problem, solution, mission, vision, roadmap and changelog are NOT here: they
 * have one producer, the Loki project profile (fleet AGENTS.md, "The identity
 * contract"), and the roadmap and changelog pages render it.
 */
export const SITE = {
  slug: "__SLUG__",
  title: "__TITLE__",
  /** The public origin. The box env may override it (NEXT_PUBLIC_APP_URL). */
  url: process.env.NEXT_PUBLIC_APP_URL || "https://__HOST__",
  repo: "https://github.com/__WORKFLOW_OWNER__/__SLUG__",
} as const;

/** The fleet map: Loki's published profile of every product, roadmap included. */
export const FLEET_MAP_URL = "https://loki.orangecat.ch/api/fleet/map";
export const FLEET_PROFILE_URL = `https://loki.orangecat.ch/fleet/${SITE.slug}`;
