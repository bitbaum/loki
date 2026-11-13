"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { deleteJson } from "@/lib/api/fetch";
import { PRIVATE_NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { UnlockForm } from "@/components/private/UnlockForm";

type PinStatus = {
  configured: boolean;
  unlocked: boolean;
};

/**
 * The PIN gate in front of a private page. It renders the same form /unlock
 * does (UnlockForm), named for the page it guards: "Memory is private", not
 * "This section is PIN-protected". A forgotten PIN still has its way out on
 * the form itself (there is no reset flow, and the form says so).
 */
export function PrivatePinGate({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [status, setStatus] = useState<PinStatus | null>(null);

  useEffect(() => {
    fetch("/api/auth/pin")
      .then((r) => r.json())
      .then((d: PinStatus) => setStatus(d))
      .catch(() => setStatus({ configured: true, unlocked: false }));
  }, []);

  if (!status) {
    return (
      <div className="app-page app-page-compact" aria-busy="true" aria-label="Loading">
        <div className="mx-auto h-56 w-full max-w-xl animate-pulse rounded-xl bg-surface-raised" />
      </div>
    );
  }

  if (!status.configured || status.unlocked) {
    return <>{children}</>;
  }

  const page = PRIVATE_NAV_ITEMS.find((item) => isCurrentPath(pathname, item.href));
  return (
    <div className="app-page app-page-compact">
      <div className="mx-auto w-full max-w-xl">
        <UnlockForm
          next={pathname}
          heading={page ? `${page.label} is private` : "This page is private"}
          lede="Enter your PIN to open it. It stays open for 30 minutes."
        />
      </div>
    </div>
  );
}

/** Call from sidebar lock button — clears httpOnly cookie and refreshes RSC tree. */
export async function lockPrivateZone(router: { refresh: () => void }) {
  await deleteJson("/api/auth/pin");
  router.refresh();
}
