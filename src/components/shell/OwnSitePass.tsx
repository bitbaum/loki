"use client";

import { useEffect } from "react";
import { storeOwnerPass } from "../../../widget/owner-pass";
import { writeWatchPaused } from "../../../widget/watch";

/**
 * Hands the signed-in owner's pass to Loki's own widget (lib/feedback/
 * own-site-pass), so the header's spiral opens the owner's panel — not the
 * visitor's sign-in door, "Made with Loki" and "Hide this button on this
 * site". Renders nothing.
 *
 * The first time, Watch starts paused: the sign-in door turned it on because
 * the owner asked for it there; here nobody asked, and Loki watching every
 * page of itself (and reading them) is the owner's choice — one tap on
 * "Watch again" in the panel.
 */
export function OwnSitePass({ token, pass }: { token: string; pass: string }) {
  useEffect(() => {
    if (storeOwnerPass(token, pass).first) writeWatchPaused(token, true);
  }, [token, pass]);
  return null;
}
