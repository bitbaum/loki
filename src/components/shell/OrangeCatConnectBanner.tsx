"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { Cat, Loader2, X } from "lucide-react";
import { isBannerFreeRoute } from "@/config/banners";
import { useFetch } from "@/hooks/use-fetch";

// localStorage, like the verify-email reminder: optional, dismiss once, gone.
const DISMISS_KEY = "loki-connect-orangecat-dismiss";

/**
 * One calm line for a signed-in person whose Loki account is not yet an
 * OrangeCat account: one click links them (the same round-trip Settings →
 * Account offers), and from then on OrangeCat's sign-in — code, Google,
 * passkey — is Loki's too, and losing the Loki password stops mattering.
 * ADR-0009 (orangecat) step D7: existing password users get a one-click link.
 *
 * Reads the link state from /api/me/connected-accounts rather than the
 * session, so a link made in another tab is seen without a sign-out.
 */
export function OrangeCatConnectBanner({ enabled }: { enabled: boolean }) {
  const { status } = useSession();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [connecting, setConnecting] = useState(false);
  const { data } = useFetch<{ accounts: { provider: string }[] }>(
    enabled && status === "authenticated" && !dismissed ? "/api/me/connected-accounts" : null,
  );

  if (!enabled || status !== "authenticated" || dismissed) return null;
  if (isBannerFreeRoute(pathname)) return null;
  if (!data || data.accounts.some((a) => a.provider === "orangecat")) return null;

  async function connect() {
    setConnecting(true);
    await signIn("orangecat", { callbackUrl: pathname ?? "/" });
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
    <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-raised px-4 py-2 text-sm">
      <Cat className="h-4 w-4 shrink-0 text-text-secondary" />
      <p className="min-w-0 flex-1 text-text-secondary">
        <span className="text-text-primary">Make this your OrangeCat account.</span> One click, then
        every OrangeCat sign-in works here too and you never need a separate Loki password.
      </p>
      <button onClick={connect} disabled={connecting} className="ui-btn-xs shrink-0">
        {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Connect OrangeCat"}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
