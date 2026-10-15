import { GitBranch } from "lucide-react";
import { LiveUrlField } from "./LiveUrlField";
import { OwnDomainButton } from "./OwnDomainButton";
import { RegisterSiteButton } from "./RegisterSiteButton";
import type { siteAddresses } from "@/lib/site-domain";

/** Website configuration and code destinations, with the existing access checks. */
export function ProjectConnectionsSection({
  projectId,
  userProjectId,
  liveUrl,
  repoUrl,
  hasRepo,
  ownerPass,
  siteAddress,
}: {
  projectId: string;
  userProjectId: string | null;
  liveUrl: string | null;
  repoUrl: string | null;
  hasRepo: boolean;
  ownerPass: string | null;
  siteAddress: ReturnType<typeof siteAddresses> | null;
}) {
  return (
    <section className="ui-project-detail-block" aria-labelledby="project-website-title">
      <h2 id="project-website-title" className="ui-project-section-title">
        Website and code
      </h2>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">Website address</p>
            <p className="mt-1 break-all text-sm text-text-secondary">
              {liveUrl ?? "No website address set."}
            </p>
          </div>
          <LiveUrlField
            userProjectId={userProjectId}
            liveUrl={liveUrl}
            readonly={false}
            ownerPass={ownerPass}
          />
        </div>
        {siteAddress && (
          <OwnDomainButton
            projectId={projectId}
            ownDomain={siteAddress.ownDomain}
            freeHost={siteAddress.freeHost}
          />
        )}
        <RegisterSiteButton projectId={projectId} hasRepo={hasRepo} liveUrl={liveUrl} />
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary min-h-11 gap-2"
          >
            <GitBranch className="h-4 w-4" aria-hidden="true" /> Open repository
          </a>
        )}
      </div>
    </section>
  );
}
