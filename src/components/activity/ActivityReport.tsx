"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { PageActionButton } from "@/components/ui/page-action";
import { MarkdownText } from "@/components/ui/markdown-text";

type DigestResponse = { markdown: string; generatedAt: string; cached: boolean };

/**
 * The page's one action: "Write a report" — Loki's own account of this
 * window, in a sheet. It was a bordered card at the foot of the feed with a
 * second filled button in it. Writing one is a model call, so it waits to be
 * asked.
 */
export function ActivityReport({ window, project }: { window: string; project: string | null }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DigestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activity/digest${force ? "?force=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ window, project }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<DigestResponse>;
      if (!res.ok || typeof data.markdown !== "string") {
        setError("Loki could not write the report this time.");
        return;
      }
      setResult(data as DigestResponse);
    } catch {
      setError("No connection. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageActionButton
        label="Write a report"
        icon={Sparkles}
        onClick={() => {
          setOpen(true);
          if (!result && !loading) void generate(false);
        }}
      />
      {open &&
        createPortal(
          <Modal
            onClose={() => setOpen(false)}
            size="xl"
            position="bottom-mobile"
            padded={false}
            labelledBy={titleId}
            className="flex flex-col"
          >
            <div className="ui-prompt-sheet-head">
              <h2 id={titleId} className="ui-prompt-sheet-title">
                Report
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ui-topbar-btn shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="ui-prompt-sheet-body">
              {loading && (
                <p className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="ui-spinner-xs" /> Loki is writing it…
                </p>
              )}
              {error && !loading && (
                <p className="ui-prompt-sheet-error" role="alert">
                  {error}{" "}
                  <button
                    type="button"
                    onClick={() => void generate(false)}
                    className="ui-link-muted"
                  >
                    Try again
                  </button>
                </p>
              )}
              {result && !loading && <MarkdownText text={result.markdown} />}
            </div>
            {result && !loading && (
              <div className="ui-sheet-foot">
                <button
                  type="button"
                  onClick={() => void generate(true)}
                  className="ui-btn-ghost min-h-11 w-full"
                >
                  Write it again
                </button>
              </div>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}
