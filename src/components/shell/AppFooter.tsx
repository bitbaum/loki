import Link from "next/link";
import { NAV } from "@/config/navigation";

// Build stamp baked in at compile time (next.config.ts) — same source as the
// sidebar version pill. SHA reflects the deployed commit on the box.
const COMMIT_SHA = (process.env.NEXT_PUBLIC_BUILD_SHA ?? "").slice(0, 7);

const ENV_LABEL = process.env.NODE_ENV === "production" ? "prod" : "local";

/**
 * Micro footer — desktop only (mobile uses MobileNav). Ambient signals: the
 * runtime environment (the deployed commit is its tooltip) and where to get
 * help. Counterweight to the sidebar so the app surface has a defined top and
 * bottom; not a content slot.
 */
export function AppFooter() {
  return (
    <footer className="ui-app-footer">
      <span
        className="ui-app-footer-cell"
        title={COMMIT_SHA ? `Deployed commit ${COMMIT_SHA}` : undefined}
      >
        <span className="ui-app-footer-dot" aria-hidden="true" />
        <span>{ENV_LABEL}</span>
      </span>
      {/* The deployed commit was printed here as a bare hash, which read as
          noise (reported 2026-10-20). It is the tooltip above, and the
          version stamp under the open sidebar's logo. */}
      <span className="ml-auto flex items-center gap-4">
        <Link href="/support" className="ui-app-footer-cell">
          Help
        </Link>
        <Link href={NAV.system.href} className="ui-app-footer-cell">
          System
        </Link>
      </span>
    </footer>
  );
}
