"use client";

import { Check, Copy, ExternalLink, Sparkles, UserPlus } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";

/**
 * What the owner sends their client, on the page where the build is watched.
 *
 * A preview exists so someone ELSE can see it: the new version at its own
 * address, the code that opens it, and — for a site that was improved — the
 * before-and-after tour (the live page and the new one photographed side by
 * side, lib/previews/before-after-page). One button copies all of it as a
 * message ready to paste into WhatsApp or mail.
 *
 * Their notes on it come to the owner. To give them a say in their own name,
 * the owner invites them as Client — a seat whose asks the owner decides on
 * and whose changes go live on their word. "Open it" carries the OWNER's pass
 * and is for the owner's browser only: it used to be the thing a client was
 * sent, and it acted as the owner for 90 days for whoever held it.
 */
export function PreviewShareCard({
  projectId,
  name,
  previewUrl,
  ownerUrl,
  code,
  tourUrl,
}: {
  projectId: string;
  name: string;
  previewUrl: string;
  ownerUrl: string;
  /** The operator's own code, or null when the studio's code applies. */
  code: string | null;
  /** The before-and-after tour, for a preview made from a live site. */
  tourUrl: string | null;
}) {
  const { copied, copy } = useClipboard();
  const message = [
    `Here is the new version of ${name}: ${previewUrl}`,
    code ? `Access code: ${code}` : null,
    tourUrl ? `Before and after, page by page: ${tourUrl}` : null,
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
            {code ? " with the code" : ""}, sees the new version and leaves notes on it. Their notes
            come to you. To let them make changes themselves, invite them as Client.
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
            <dt>Before and after</dt>
            <dd className="wrap-anywhere">{tourUrl}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className="ui-btn-primary min-h-11" onClick={() => copy(message)}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? "Copied — paste it to them" : "Copy message for your client"}
        </button>
        <a href={`/projects/${projectId}#people`} className="ui-btn-secondary min-h-11">
          <UserPlus className="h-4 w-4" aria-hidden /> Invite them as Client
        </a>
        <a href={ownerUrl} target="_blank" rel="noreferrer" className="ui-btn-secondary min-h-11">
          <ExternalLink className="h-4 w-4" aria-hidden /> Open it yourself
        </a>
        {tourUrl && (
          <a href={tourUrl} target="_blank" rel="noreferrer" className="ui-btn-secondary min-h-11">
            Before and after
          </a>
        )}
      </div>
    </section>
  );
}
