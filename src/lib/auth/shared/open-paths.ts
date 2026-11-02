/**
 * AccountKit endpoints Loki's screens reach directly on the shared runtime,
 * past the compat layer (which answers 404 for everything it does not
 * translate). They add ways in and ways to protect an account; none of them
 * writes a password, so Loki's `users` stays the one credential writer
 * (docs/architecture/accountkit-migration.md).
 *
 * - passkeys: sign in with one, and add, list, rename or remove one's own;
 * - the second factor: turn it on or off (password-checked) and answer it at
 *   sign-in with a code or a backup code;
 * - the sign-in link: ask for one by email, and open it.
 *
 * `/sign-in/email` is already open in the compat layer; the sign-in screen
 * calls it directly so a second-factor answer can follow on the same card.
 */
export const OPEN_SHARED_PATHS: ReadonlySet<string> = new Set([
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/list-user-passkeys",
  "/passkey/update-passkey",
  "/passkey/delete-passkey",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/generate-backup-codes",
  "/sign-in/magic-link",
  "/magic-link/verify",
]);

/** Whether a request under /api/auth goes to AccountKit itself rather than the compat layer. */
export function isOpenSharedPath(pathname: string): boolean {
  return OPEN_SHARED_PATHS.has(pathname.replace(/^\/api\/auth/, "").replace(/\/+$/, ""));
}
