"use client";

// Bulk-import GitHub repos as Loki projects.
//
// Lives under /control/ so the AppShell + auth gate + onboarding redirect
// behave consistently. Reached either from the /control empty state
// ("Import from GitHub" CTA) or from a "Add more from GitHub" link once
// projects already exist.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, GitBranch } from "lucide-react";
import Link from "next/link";
import { PageLayout } from "@/components/ui/page-layout";
import { RepoMultiPicker } from "@/components/onboarding/RepoMultiPicker";

type BulkResponse = {
  created: { id: string; name: string; repoId: number }[];
  skipped: { repoId: number; reason: string }[];
  total: number;
};

export default function ImportFromGithubPage() {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [error, setError] = useState("");

  async function handleImport() {
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/projects/bulk-from-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoIds: selectedIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Import failed (HTTP ${res.status})`);
        setImporting(false);
        return;
      }
      const data = (await res.json()) as BulkResponse;
      setResult(data);
      // If everything landed cleanly, jump to /control. Otherwise stay on
      // this page so the user can see what was skipped.
      if (data.skipped.length === 0) {
        router.push("/control");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <PageLayout title="Import from GitHub" back={{ href: "/control", label: "Back to Home" }}>
      <div className="max-w-2xl space-y-6">
        <div className="ui-card-shell space-y-4 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <GitBranch className="h-5 w-5 text-text-secondary mt-0.5" />
            <div className="space-y-1">
              <h2 className="ui-page-subtitle">Pick the repos you want to manage</h2>
              <p className="text-sm text-text-muted">
                Each selected repo becomes a Loki project. You can import all of them now and remove
                individual ones later — duplicates by name are silently skipped.
              </p>
            </div>
          </div>

          {result && result.skipped.length > 0 && (
            <div className="ui-tag-warning p-3 rounded-md text-sm">
              Imported {result.created.length} project{result.created.length === 1 ? "" : "s"}.
              Skipped {result.skipped.length}: {result.skipped.map((s) => s.reason).join(", ")}.{" "}
              <Link href="/control" className="underline">
                Go to Control →
              </Link>
            </div>
          )}

          {error && <div className="ui-error p-3 rounded-md text-sm">{error}</div>}

          <input
            type="search"
            placeholder="Filter by name or description…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ui-input w-full"
          />

          <RepoMultiPicker
            filter={filter}
            onSelectionChange={(ids) => {
              setSelectedIds(ids);
              setResult(null);
            }}
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
            <Link href="/control" className="ui-btn-ghost">
              Skip for now
            </Link>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || selectedIds.length === 0}
              className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing {selectedIds.length}…
                </>
              ) : (
                <>
                  Import {selectedIds.length} {selectedIds.length === 1 ? "project" : "projects"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
