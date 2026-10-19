import type { SiteDeployment } from "@/hooks/use-site-deployment";

/** Shared evidence and next action for kickoff and registration retry. */
export function SiteDeploymentStatus({ deployment }: { deployment: SiteDeployment | null }) {
  if (!deployment) return null;
  return (
    <div className="max-w-xl space-y-2" role="status">
      <p className="text-xs text-text-secondary">
        {deployment.liveUrl
          ? "Site deployed. Follow the build on Home to see when your brief is implemented."
          : deployment.reason || "Deployment started — waiting for the site to respond."}
      </p>
      {deployment.liveUrl ? (
        <a href={deployment.liveUrl} target="_blank" rel="noreferrer" className="ui-btn-secondary">
          Open live site
        </a>
      ) : deployment.deploymentUrl ? (
        <a
          href={deployment.deploymentUrl}
          target="_blank"
          rel="noreferrer"
          className="ui-btn-secondary"
        >
          Check deployment
        </a>
      ) : null}
      {deployment.command && !deployment.registered && (
        <details className="text-xs text-text-secondary">
          <summary>Operator setup instructions</summary>
          <code className="block break-all">{deployment.command}</code>
        </details>
      )}
    </div>
  );
}
