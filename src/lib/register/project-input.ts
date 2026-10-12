import type { UserProject } from "@/db/schema/user-projects";
import type { RegisterProjectInput } from "./build";

/**
 * A stored project as the register reads it. One mapping for every caller:
 * four hand-written copies of this object drifted before (the public register
 * once dropped `description` while the map kept it), and a copy that forgot
 * the consent fields would publish client work the client never agreed to.
 */
export function registerInput(p: UserProject): RegisterProjectInput {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    hostedApp: p.hostedApp,
    gitUrl: p.gitUrl,
    liveUrl: p.liveUrl,
    orangecatProjectId: p.orangecatProjectId,
    solonOrgSlug: p.solonOrgSlug,
    isActive: p.isActive,
    clientWork: p.clientWork,
    portfolioConsentAt: p.portfolioConsentAt,
  };
}
