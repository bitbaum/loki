"use client";

import { useMemo, useState } from "react";
import { handoffAttachment, parseSiteHandoff, type SiteHandoff } from "@/lib/loki/site-handoff";
import type { TextAttachment } from "@/lib/loki/attachments";

/**
 * A conversation carried in from the owner's site (?q= from the widget's
 * "Continue in Loki"): shown as a card, attached once to the first message,
 * then spent. Spending never touches the prefill itself — the composer is
 * keyed on it, and remounting mid-send loses the model choice.
 */
export function useSiteHandoff(prefill: string | null): {
  /** The carried-in conversation, until it is sent or put aside. */
  handoff: SiteHandoff | null;
  /** True when ?q= was a hand-off at all (the composer then starts empty). */
  arrived: boolean;
  attachment: TextAttachment | null;
  spend: () => void;
} {
  const parsed = useMemo(() => parseSiteHandoff(prefill), [prefill]);
  const [spent, setSpent] = useState<string | null>(null);
  const handoff = parsed && spent !== parsed.text ? parsed : null;
  return {
    handoff,
    arrived: parsed !== null,
    attachment: handoff ? handoffAttachment(handoff) : null,
    spend: () => handoff && setSpent(handoff.text),
  };
}
