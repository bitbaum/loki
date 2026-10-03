/**
 * What may become a site on the box — the one list and the one grammar.
 *
 * Two modules enforced this independently: lib/site-cd (live CD registration)
 * and lib/hosted-runner/new-site (a dispatched provisioning request). Their
 * reserved lists were character-for-character identical, which is exactly the
 * shape of duplication that stops being identical without anyone noticing: a
 * label added to one is a door left open in the other.
 *
 * This file has no imports on purpose. new-site runs inside the hosted runner
 * and should not pull the GitHub provisioning graph in just to reject a slug.
 *
 * scripts/hetzner/new-site.sh keeps ITS own copy and stays the authority: two
 * independent refusals of the same class is defence in depth, and if they ever
 * disagree, the script wins and this file is the one that is wrong.
 */

/**
 * Reserved DNS / infra labels. A kickoff that claimed loki.orangecat.ch would
 * be a hostile rename of the control plane.
 */
export const RESERVED_SITE_SLUGS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "support",
  "security",
  "billing",
  "pay",
  "wallet",
  "login",
  "auth",
  "account",
  "mail",
  "smtp",
  "imap",
  "ns1",
  "ns2",
  "mx",
  "cdn",
  "static",
  "assets",
  "vpn",
  "db",
  "status",
  "staging",
  "dev",
  "test",
  "preview",
  "bridge",
  "loki",
  "orangecat",
  "supabase",
  "solon",
  "evig",
  "revampit",
  "root",
  "system",
]);

/**
 * A slug becomes a DNS label, a TLS subject, a directory and a systemd unit.
 * Same grammar new-site.sh enforces: lowercase alphanumerics and hyphens, never
 * leading or trailing a hyphen, 63 characters max (the DNS label limit).
 */
export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The DNS label limit SLUG_RE encodes. */
export const MAX_SLUG_LENGTH = 63;

/** Well-formed AND not spoken for. */
export function isValidSiteSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SITE_SLUGS.has(slug);
}
