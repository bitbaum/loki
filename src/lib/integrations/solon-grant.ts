import { createHmac } from "node:crypto";

/**
 * A grant Loki signs so Solon can record which project an organization governs.
 *
 * Solon lets anyone found an organization — permissionless, on proof. What it
 * will not let happen is a name coincidence making that organization look like
 * one of ours: it records `claimed_project` only when the founder arrives with
 * this grant, signed for THEIR OrangeCat identity. Loki issues it only to the
 * owner of a project whose OrangeCat account is linked, so a claim means "the
 * person who owns this project in Loki founded this organization for it".
 *
 * Loki's port of Solon's src/lib/loki-grant.ts, pinned to it by a shared test
 * vector (scripts/test/solon-grant.ts) — the same way solon-message.ts is
 * pinned for votes. Signed with SOLON_WEBHOOK_SECRET, which both deployments
 * already share; a grant cannot be mistaken for a webhook, whose signed bytes
 * are a JSON body.
 */

/**
 * Short on purpose. A link is minted when the owner asks for it, and anything
 * that outlives a sitting is a link someone could forward.
 */
export const SOLON_GRANT_TTL_SECS = 30 * 60;

/** Solon caps an organization's description here; a longer one would be refused. */
const DESCRIPTION_MAX = 500;

export function solonGrantMessage(params: {
  project: string;
  actorId: string;
  exp: number;
}): string {
  return `solon-org-grant\nproject:${params.project}\nactor:${params.actorId}\nexp:${params.exp}`;
}

export function signSolonGrant(
  params: { project: string; actorId: string; exp: number },
  secret: string,
): string {
  return createHmac("sha256", secret).update(solonGrantMessage(params)).digest("hex");
}

/**
 * Solon's founding page, pre-filled for this project and carrying the grant.
 *
 * Null when this deployment holds no shared secret. Founding still works on
 * Solon without one — but Loki could not vouch for it, so it does not offer a
 * link that would quietly found an organization governing nothing.
 */
export function solonFoundingUrl(params: {
  base: string;
  project: string;
  name: string;
  description: string | null;
  actorId: string;
  secret: string | undefined;
  nowSecs: number;
}): string | null {
  if (!params.secret) return null;
  const exp = params.nowSecs + SOLON_GRANT_TTL_SECS;
  const query = new URLSearchParams({
    slug: params.project,
    name: params.name,
    ...(params.description ? { description: params.description.slice(0, DESCRIPTION_MAX) } : {}),
    project: params.project,
    exp: String(exp),
    grant: signSolonGrant({ project: params.project, actorId: params.actorId, exp }, params.secret),
  });
  return `${params.base.replace(/\/+$/, "")}/orgs/new?${query.toString()}`;
}
