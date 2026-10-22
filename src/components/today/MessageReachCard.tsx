"use client";

import Link from "next/link";
import { useState } from "react";
import { handleReject } from "@/app/actions";
import { haptic } from "@/lib/haptics";
import { NAV } from "@/config/navigation";

/**
 * A matched contact — not a send. Outbound is frozen while the book is
 * profiles + enrichment. The draft stays visible as a note, not a launch.
 */
export function MessageReachCard({
  actionId,
  name,
  personId,
  channel,
  address,
  body,
  profession,
}: {
  actionId: string;
  name: string;
  personId: string | null;
  channel: string | null;
  address: string | null;
  body: string;
  profession: string | null;
}) {
  const [skipped, setSkipped] = useState(false);

  const profileHref = personId
    ? `${NAV.people.href}?open=${encodeURIComponent(personId)}`
    : NAV.people.href;

  if (skipped) {
    return <p className="text-sm text-text-muted">Dismissed.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-text-muted">Matched contact — nothing was sent.</p>
        <Link
          href={profileHref}
          className="text-sm font-medium text-text-primary underline-offset-2 hover:underline"
        >
          {name}
        </Link>
        {profession && <p className="text-xs text-text-secondary">{profession}</p>}
        {address && (
          <p className="mt-0.5 text-xs text-text-secondary">
            {channel ?? "channel"}: {address}
          </p>
        )}
      </div>
      {body && (
        <p className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-page px-3 py-2 text-sm text-text-secondary">
          {body}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={profileHref} className="ui-btn-secondary min-h-11 justify-center text-sm">
          Open profile
        </Link>
        <button
          type="button"
          onClick={async () => {
            haptic();
            await handleReject(actionId);
            setSkipped(true);
          }}
          className="ui-btn-ghost min-h-11 text-sm"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
