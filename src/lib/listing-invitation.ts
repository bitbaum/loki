/**
 * When Loki asks an owner whether a project may go in the public catalogue.
 *
 * SSOT for that question, and pure so it can be tested without a database or a
 * browser. The UI decides how to ask; this decides whether to.
 *
 * WHY ASK AT ALL. Consent is stored (user_projects.listed_publicly, default
 * false) and reachable from a toggle on this page — but a control nobody knows
 * about produces one answer, and it is no. An empty catalogue then looks like a
 * broken feature, and the historical fix for that was to widen the query until
 * it showed everyone's projects whether they had agreed or not. Asking is what
 * makes consent a real choice rather than a hurdle.
 *
 * WHY NOT ASK ALWAYS. An invitation on an empty project registered ten seconds
 * ago is noise, and noise is what teaches people to dismiss things unread. The
 * bar below is the smallest evidence that a project is a real one.
 */

export type ListingInvitationInput = {
  /** Already consented — there is nothing left to ask. */
  listedPublicly: boolean;
  /** The owner already said "not now" for this project. */
  dismissedAt: Date | string | null;
  /** Retired projects are not candidates for a shop window. */
  isActive: boolean;
  /** A repository is the evidence that this is a project and not a placeholder. */
  gitUrl: string | null;
  /** Viewing someone else's project (org peer): never their decision to take. */
  readonly: boolean;
};

/**
 * The bar is deliberately "has a repo and is active", NOT "has a live URL".
 *
 * The catalogue's own facets include "Being built" alongside "Live", so a
 * project that has not shipped yet still belongs there — requiring a deployed
 * site would ask only the projects that least need the exposure. A repo is
 * enough to prove the thing exists and has somewhere to point.
 */
export function shouldInviteToPublicCatalogue(p: ListingInvitationInput): boolean {
  if (p.readonly) return false;
  if (p.listedPublicly) return false;
  if (p.dismissedAt) return false;
  if (!p.isActive) return false;
  return Boolean(p.gitUrl?.trim());
}
