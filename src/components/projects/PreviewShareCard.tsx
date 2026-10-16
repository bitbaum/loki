"use client";

import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";

/**
 * What the owner sends their client, on the page where the build is watched.
 *
 * A preview exists so someone ELSE can see it: the new version at its own
 * address, the code that opens it, and — for a site that was improved — the
 * tour of what changed (improvements.html, written by the build). One button
 * copies all of it as a message ready to paste into WhatsApp or mail; the
 * owner's own link carries the pass that turns their notes into builds.
 */
export function PreviewShareCard({
  name,
  previewUrl,
  ownerUrl,
  code,
  tourUrl,
}: {
  name: string;
  previewUrl: string;
  ownerUrl: string;
  /** The operator's own code, or null when the studio's code applies. */
  code: string | null;
  /** improvements.html, for a preview made from a live site. */
  tourUrl: string | null;
}) {
  const { copied, copy } = useClipboard();
  const message = [
    `Here is the new version of ${name}: ${previewUrl}`,
    code ? `Access code: ${code}` : null,
    tourUrl ? `What changed and why: ${tourUrl}` : null,
    "Tell me what you think — you can leave notes right on the page.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <section className="ui-preview-share" aria-label="Show it to your client">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-text-primary">A private link, ready to show</p>
          <p className="text-sm text-text-secondary">
            No repository and nothing public yet — the client opens this link
            {code ? " with the code" : ""}, sees the new version and leaves notes on it. Notes start
            changes.
          </p>
        </div>
      </div>
      <dl className="ui-preview-share-facts">
        <div>
          <dt>Link</dt>
          <dd className="wrap-anywhere">{previewUrl}</dd>
        </div>
        {code && (
          <div>
            <dt>Code</dt>
            <dd className="font-mono">{code}</dd>
          </div>
        )}
        {tourUrl && (
          <div>
            <dt>What changed</dt>
            <dd className="wrap-anywhere">{tourUrl}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn-primary min-h-11" onClick={() => copy(message)}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? "Copied — paste it to them" : "Copy message for your client"}
        </button>
        <a href={ownerUrl} target="_blank" rel="noreferrer" className="ui-btn-secondary min-h-11">
          <ExternalLink className="h-4 w-4" aria-hidden /> Open it
        </a>
        {tourUrl && (
          <a href={tourUrl} target="_blank" rel="noreferrer" className="ui-btn-secondary min-h-11">
            What changed
          </a>
        )}
      </div>
    </section>
  );
}
