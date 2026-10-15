/**
 * Whose PIN gates an account's private zone — pure, so it is testable without
 * a database. See `getEffectivePinHash` in private-zone.ts for why the env PIN
 * belongs to the owner account alone.
 */
/** The account's own PIN, else the env PIN — for the owner account only. */
export function effectivePinHash(
  user: { hash: string | null; isDefault: boolean | null } | null,
  envHash: string | undefined,
): string | null {
  const own = user?.hash?.trim();
  if (own) return own;
  return user?.isDefault ? envHash?.trim() || null : null;
}
