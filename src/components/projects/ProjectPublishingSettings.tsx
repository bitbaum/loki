import type { UserProject } from "@/db/schema/user-projects";
import { OrangeCatPublishButton } from "./OrangeCatPublishButton";
import { ProjectPublicListingToggle } from "./ProjectPublicListingToggle";
import { ProjectFeatureToggle } from "./ProjectFeatureToggle";
import { ProjectClientConsent } from "./ProjectClientConsent";
import { SolonFoundButton } from "./SolonFoundButton";

/** Public destinations belong together, away from everyday work. */
export function ProjectPublishingSettings({
  projectId,
  userProject,
  clientWork,
  clientConsentAt,
  awaitingClientConsent,
  viewerIsSiteOperator,
  shareAction,
}: {
  projectId: string;
  userProject: UserProject | null;
  clientWork: boolean;
  clientConsentAt: string | null;
  awaitingClientConsent: boolean;
  viewerIsSiteOperator: boolean;
  shareAction?: React.ReactNode;
}) {
  const destinations = [
    {
      key: "link",
      title: "A link to send",
      explain: "A read-only page for someone without an account. You choose what it shows.",
      control: shareAction ?? null,
    },
    {
      key: "catalogue",
      title: userProject?.listedPublicly ? "Listed in Loki's catalogue" : "Loki's catalogue",
      explain: awaitingClientConsent
        ? "Client work stays off public pages, listed or not, until the client agrees (below)."
        : userProject?.listedPublicly
          ? "Shown on the public fleet page, credited to you."
          : "Not listed. Listing shows it on the public fleet page, credited to you.",
      control: (
        <span className="flex flex-wrap items-center gap-1.5">
          <ProjectPublicListingToggle
            projectId={projectId}
            listedPublicly={userProject?.listedPublicly ?? false}
          />
          {viewerIsSiteOperator && (
            <ProjectFeatureToggle
              projectId={projectId}
              featured={Boolean(userProject?.featuredAt)}
              listedPublicly={userProject?.listedPublicly ?? false}
            />
          )}
        </span>
      ),
    },
    {
      key: "client",
      title: clientWork
        ? clientConsentAt
          ? "Client work, shown with consent"
          : "Client work, private"
        : "Client work",
      explain: clientWork
        ? "Built for a real person or organisation. It appears in the public portfolio only once they agree."
        : "Our own work. Mark it if it was built for someone else.",
      control: userProject ? (
        <ProjectClientConsent
          projectId={projectId}
          clientWork={clientWork}
          consentedAt={clientConsentAt}
          consentNote={userProject.portfolioConsentNote ?? null}
        />
      ) : null,
    },
    {
      key: "orangecat",
      title: "OrangeCat",
      explain: "A public page where people can follow, share and fund it.",
      control: <OrangeCatPublishButton projectId={projectId} />,
    },
    {
      key: "solon",
      title: "Solon",
      explain:
        "Found it as a venture others govern with you. Signed with your own wallet, so Loki hands you over.",
      control: <SolonFoundButton projectId={projectId} />,
    },
  ];
  return (
    <section className="ui-project-detail-block" aria-labelledby="project-sharing-title">
      <h2 id="project-sharing-title" className="ui-project-section-title">
        Sharing and publishing
      </h2>
      <ul className="divide-y divide-border-subtle">
        {destinations
          .filter((destination) => destination.control)
          .map((destination) => (
            <li
              key={destination.key}
              className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-text-primary">{destination.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                  {destination.explain}
                </p>
              </div>
              <div className="shrink-0">{destination.control}</div>
            </li>
          ))}
      </ul>
    </section>
  );
}
