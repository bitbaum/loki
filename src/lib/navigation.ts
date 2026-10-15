export function isCurrentPath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/** The project detail owns its title and navigation; review views own their title too; nested run views do not. */
export function isProjectWorkspacePath(pathname: string): boolean {
  return /^\/projects\/[^/]+(?:\/review)?\/?$/.test(pathname);
}
