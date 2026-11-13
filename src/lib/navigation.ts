export function isCurrentPath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/** The project detail owns its title and navigation; review views own their title too; nested run views do not. */
export function isProjectWorkspacePath(pathname: string): boolean {
  return /^\/projects\/[^/]+(?:\/review)?\/?$/.test(pathname);
}

/**
 * Every page of one project names itself in its own header ("← Orangecat",
 * "Watch it work"), so the top bar says nothing there. It said "Projects" on
 * watch and workbench but nothing on the overview and review — three names
 * stacked for one place on watch (2026-11-12).
 */
export function isProjectPagePath(pathname: string): boolean {
  return /^\/projects\/[^/]+(?:\/.*)?$/.test(pathname);
}
