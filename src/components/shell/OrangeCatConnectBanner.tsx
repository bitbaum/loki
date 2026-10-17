"use client";

import { useState, type ReactNode } from "react";
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
 *
 * `fallback` is the reminder to show INSTEAD when this one has nothing to say.
 * A new account used to get this line and the verify-email one stacked, about
 * a fifth of a phone screen above every page (seen at 390px, 2026-10-17) —
 * two optional chores outranking the work. One reminder at a time; linking
 * OrangeCat goes first because its sign-in makes the other one matter less.
 */
export function OrangeCatConnectBanner({
  enabled,
  fallback = null,
}: {
  enabled: boolean;
  fallback?: ReactNode;
}) {
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
  const [connecting, setConnecting] = useState(false);
  const { data, error } = useFetch<{ accounts: { provider: string }[] }>(
    enabled && status === "authenticated" && !dismissed ? "/api/me/connected-accounts" : null,
  );

  if (status === "loading") return null;
  if (!enabled || status !== "authenticated" || dismissed) return <>{fallback}</>;
  // The demo account is shared and cannot link one (its credentials are
  // fixed); the demo strip already holds the top of the screen there.
  if (session?.user?.isDemo) return null;
  if (isBannerFreeRoute(pathname)) return null;
  // Could not ask: say nothing of ours, and let the other reminder stand.
  if (error) return <>{fallback}</>;
  // Still asking: neither line yet, so the other one does not flash and go.
  if (!data) return null;
  if (data.accounts.some((a) => a.provider === "orangecat")) return <>{fallback}</>;

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
      {/* One line on a phone too. The full sentence beside a button and a close
          X wrapped into an eight-line column, 150px above every page (seen at
          390px, 2026-10-04); there, the headline and a short "Connect" say it. */}
      <p className="min-w-0 flex-1 text-text-secondary">
        <span className="text-text-primary">Make this your OrangeCat account.</span>
        <span className="max-sm:hidden">
          {" "}
          One click, then every OrangeCat sign-in works here too and you never need a separate Loki
          password.
        </span>
      </p>
      <button
        onClick={connect}
        disabled={connecting}
        aria-label="Connect OrangeCat"
        className="ui-btn-xs shrink-0"
      >
        {connecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>
            Connect<span className="max-sm:hidden"> OrangeCat</span>
          </>
        )}
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
