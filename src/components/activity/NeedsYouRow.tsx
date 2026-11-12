"use client";

import { useState } from "react";
import { ListRow } from "@/components/ui/list-row";
import type { ActivityEvent } from "@/lib/activity-events";
import { ActivityRetryButton, type RetryNote } from "./ActivityRetryButton";

/**
 * One row of "Runs need you", with its "Run again". Once pressed, the row's
 * grey line becomes what happened to the retry — "Not sent — you're typing in
 * that session right now", "Running" — because the button's tooltip, where
 * that used to go, never shows on a phone.
 */
export function NeedsYouRow({
  event,
  href,
  title,
  secondary,
  retryLabel,
}: {
  event: ActivityEvent;
  href: string;
  title: string;
  secondary: string;
  retryLabel?: string;
}) {
  const [note, setNote] = useState<RetryNote | null>(null);
  return (
    <ListRow
      href={href}
      status={note?.tone ?? "negative"}
      title={title}
      secondary={note?.text ?? secondary}
      menu={<ActivityRetryButton event={event} label={retryLabel} onNote={setNote} />}
    />
  );
}
