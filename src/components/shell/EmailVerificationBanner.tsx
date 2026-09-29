"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { MailWarning, X } from "lucide-react";
import { ROUTES } from "@/config/auth";
import { COMMS_COPY } from "@/config/comms";
import { postJson } from "@/lib/api/fetch";
import { isBannerFreeRoute } from "@/config/banners";

// localStorage (not sessionStorage): an OPTIONAL reminder that the user chose to
// dismiss shouldn't reappear in every new tab. Dismiss once, gone for good.
const DISMISS_KEY = "loki-verify-email-dismiss";

/** Optional verification reminder — email is not required to use the app. One
 *  calm line so it never outranks the actual page content beneath it. */
export function EmailVerificationBanner() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (status !== "authenticated" || dismissed) return null;
  if (isBannerFreeRoute(pathname)) return null;

  const email = session?.user?.email;
  const verified = session?.user?.emailVerified;
  if (!email || verified) return null;

  async function resend() {
    setSending(true);
    try {
      await postJson("/api/auth/resend-verification", { email });
      setSent(true);
    } catch {
      /* ignore — user can retry from Settings */
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    // Message on its own row below `sm`, actions under it. One row could not
    // hold a sentence plus two buttons and a dismiss in 358px: the message
    // truncated to "Verify your email for …" — which drops the word
    // ("optional") that decides whether the reader should care — and the
    // actions were squeezed into a strip too tight to aim at.
    <div className="ui-callout-accent mx-3 mb-2 mt-2 flex flex-col gap-2 py-2 text-xs text-text-secondary sm:mx-4 sm:flex-row sm:items-center sm:py-1.5">
      <div className="flex min-w-0 items-start gap-2">
        <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary sm:mt-0" />
        <span className="min-w-0 flex-1 sm:truncate">
          {sent ? COMMS_COPY.verifySent : COMMS_COPY.verifyBanner}
        </span>
        <button
          type="button"
          className="ui-btn-icon -mt-1 shrink-0 sm:hidden"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 sm:ml-auto sm:shrink-0">
        {!sent && (
          <button
            type="button"
            className="ui-btn-ghost ui-btn-xs shrink-0"
            disabled={sending}
            onClick={() => void resend()}
          >
            {sending ? "Sending…" : "Resend"}
          </button>
        )}
        <Link
          href={ROUTES.VERIFY_EMAIL}
          className="ui-tap inline-flex shrink-0 items-center text-accent-text underline"
        >
          Learn more
        </Link>
        <button
          type="button"
          className="ui-btn-icon hidden shrink-0 sm:inline-flex"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
