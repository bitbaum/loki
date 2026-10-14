import { ExternalLink } from "lucide-react";
import { versionLabel, type OpenUpdate } from "@/lib/packages/view";
import { BreakingTag, UpdateStatusTag } from "./UpdateStatusTag";

/**
 * "Update open → v2.0.0 · breaking · held for you · #12" under a package that
 * has a Dependabot pull request waiting, with Loki's last note on it.
 */
export function OpenUpdateLine({ update }: { update: OpenUpdate }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
        <span>
          Update open → <span className="font-mono">{versionLabel(update.to)}</span>
        </span>
        {update.breaking && <BreakingTag />}
        <UpdateStatusTag status={update.status} />
        <a
          href={update.prUrl}
          target="_blank"
          rel="noreferrer"
          className="ui-link-subtle inline-flex items-center gap-1"
        >
          #{update.prNumber}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
      {update.detail && <p className="text-xs text-text-tertiary">{update.detail}</p>}
    </div>
  );
}
