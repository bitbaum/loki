import Link from "next/link";
import { NAV } from "@/config/navigation";

const ENV_LABEL = process.env.NODE_ENV === "production" ? "prod" : "local";

/**
 * Micro footer — desktop only (mobile uses MobileNav). Ambient signal: the
 * runtime environment, then where to get help. Counterweight to the sidebar
 * so the app surface has a defined top and bottom; not a content slot.
 *
 * It printed the deployed commit hash until 2026-10-20 — a string that means
 * nothing to anyone reading the page (owner: "replace the footer hash with a
 * link to the help page"). The build stays one hover away on the sidebar's
 * version stamp (BrandVersion), which is where "which build is this" lives.
 */
export function AppFooter() {
  return (
    <footer className="ui-app-footer">
      <span className="ui-app-footer-cell">
        <span className="ui-app-footer-dot" aria-hidden="true" />
        <span>{ENV_LABEL}</span>
      </span>
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
