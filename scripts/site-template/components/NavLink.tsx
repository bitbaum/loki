"use client";

import { Link, usePathname } from "@/i18n/navigation";
import type { Route } from "@/lib/routes";

/**
 * A link inside a nav that ANNOUNCES the current page (aria-current), not only
 * styles it — fleet SHARED.md, navigation contract rule 1.
 */
export function NavLink({
  href,
  className,
  children,
}: {
  href: Route;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return (
    <Link href={href} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
