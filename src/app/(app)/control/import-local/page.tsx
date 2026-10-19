// Local-folder import — the second-most-common project source after GitHub.
// Users paste a one-liner in their terminal; the script scans ~/dev / ~/code /
// ~/Projects / ~/Code, finds git repos, and POSTs them as projects.

import Link from "next/link";
import { Terminal, ExternalLink } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { CopyableCommand } from "@/components/control/CopyableCommand";
import { APP_URL } from "@/config/brand";

export const metadata = { title: "Import from local ~/dev" };

export default function ImportFromLocalPage() {
  const command = `curl -sS ${APP_URL}/import-from-local.sh \\
  | FC_TOKEN=ck_xxxxxxxxxxxx bash`;
  const customRootsCommand = `FC_ROOTS="$HOME/my-stuff:$HOME/work" FC_TOKEN=ck_... bash <(curl -sS ${APP_URL}/import-from-local.sh)`;

  return (
    <PageLayout
      title="Import from your local dev folder"
      back={{ href: "/control", label: "Back to Home" }}
    >
      <div className="max-w-2xl space-y-6">
        <div className="ui-card-shell space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <Terminal className="h-5 w-5 text-text-secondary mt-0.5" />
            <div className="space-y-1">
              <h2 className="ui-page-subtitle">
                One terminal command — scan ~/dev, import every git repo
              </h2>
              <p className="text-sm text-text-muted">
                The script walks{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">~/dev</code>,{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">~/code</code>,{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">~/Code</code>,{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">~/Projects</code>{" "}
                (max 3 levels deep), filters to folders with a{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">.git</code>{" "}
                directory, and POSTs each as a Loki project. Re-running is safe — duplicates by name
                are skipped.
              </p>
            </div>
          </div>

          <ol className="space-y-4 text-sm">
            <li>
              <div className="font-medium text-text-primary mb-1">1. Mint a token</div>
              <p className="text-text-muted mb-2">
                Generate a{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">ck_*</code> agent
                token — this is what authenticates your terminal as you.
              </p>
              <Link
                href="/settings"
                className="ui-btn-secondary inline-flex items-center gap-1.5 text-sm"
              >
                Open Settings → Agent tokens
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </li>

            <li>
              <div className="font-medium text-text-primary mb-1">2. Run this command</div>
              <p className="text-text-muted mb-2">
                Replace{" "}
                <code className="px-1 rounded bg-surface-base text-text-primary">
                  ck_xxxxxxxxxxxx
                </code>{" "}
                with the token you just generated, then paste in any terminal:
              </p>
              <CopyableCommand command={command} />
            </li>

            <li>
              <div className="font-medium text-text-primary mb-1">3. See them on Home</div>
              <p className="text-text-muted">
                When the command finishes printing &quot;✓ Imported N project(s)&quot;, refresh{" "}
                <Link href="/control" className="text-accent-text underline">
                  /control
                </Link>{" "}
                — your local repos will appear alongside any GitHub imports.
              </p>
            </li>
          </ol>

          <div className="pt-3 border-t border-border-subtle text-xs text-text-tertiary">
            <p className="mb-1">
              <span className="font-medium text-text-secondary">Custom dev folders?</span> Override
              the scan paths:
            </p>
            <code className="block p-2 rounded bg-surface-base text-text-secondary overflow-x-auto">
              {customRootsCommand}
            </code>
          </div>
        </div>

        <p className="text-sm text-text-muted">
          Looking for GitHub instead?{" "}
          <Link href="/control/import" className="text-accent-text underline">
            Import from GitHub →
          </Link>
        </p>
      </div>
    </PageLayout>
  );
}
