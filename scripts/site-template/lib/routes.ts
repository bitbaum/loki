/** Every internal path, once (fleet SHARED.md, navigation contract rule 6). */
export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  account: "/account",
  blog: "/blog",
  roadmap: "/roadmap",
  changelog: "/changelog",
} as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * Where to go after signing in. Only a path inside this site is accepted, so a
 * crafted `?next=https://evil.example` or `//evil.example` cannot turn the
 * sign-in page into an open redirect.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return ROUTES.account;
  }
  return value;
}
