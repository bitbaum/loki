import { GitBranch } from "lucide-react";
import { SettingRow, SettingRows } from "@/components/ui/setting-rows";
import { LiveUrlField } from "./LiveUrlField";
import { OwnDomainButton } from "./OwnDomainButton";
import { RegisterSiteButton } from "./RegisterSiteButton";
import type { siteAddresses } from "@/lib/site-domain";
import { plainWords } from "@/lib/project-display";

/** The repository's owner/name, which is what a person recognises it by. */
function repoName(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?github\.com\//, "").replace(/\.git$/, "");
}

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
      <SettingRows>
        <SettingRow
          title="Website address"
          note={<span className="break-all">{liveUrl ? plainWords(liveUrl) : "Not set yet."}</span>}
        >
          <LiveUrlField
            userProjectId={userProjectId}
            liveUrl={liveUrl}
            readonly={false}
            ownerPass={ownerPass}
          />
        </SettingRow>
        {siteAddress && (
          <SettingRow
            title="Your own domain"
            note={
              siteAddress.ownDomain
                ? `The site is at ${siteAddress.ownDomain}.`
                : "Use an address you own instead of the free one."
            }
          >
            <OwnDomainButton
              projectId={projectId}
              ownDomain={siteAddress.ownDomain}
              freeHost={siteAddress.freeHost}
            />
          </SettingRow>
        )}
        {/* Only while there is code and no site yet — the button's own rule. */}
        {hasRepo && !liveUrl && (
          <SettingRow
            title="Deployment"
            note="The code has no site yet. This sets one up, or tries again."
          >
            <RegisterSiteButton projectId={projectId} hasRepo={hasRepo} liveUrl={liveUrl} />
          </SettingRow>
        )}
        {repoUrl && (
          <SettingRow title="Code" note={<span className="break-all">{repoName(repoUrl)}</span>}>
            <a href={repoUrl} target="_blank" rel="noreferrer" className="ui-btn-secondary gap-2">
              <GitBranch className="h-4 w-4" aria-hidden="true" /> Open repository
            </a>
          </SettingRow>
        )}
      </SettingRows>
    </section>
  );
}
