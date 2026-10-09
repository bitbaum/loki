/**
 * How long a pass has left, for the Billing tab and the operator's Plans
 * card. Reads the clock here, in a plain function, so no component has to
 * (the purity rule: no Date.now() in render).
 */
export function passDaysLeft(expiresAt: Date | string | null | undefined): number | null {
  if (!expiresAt) return null;
  const end = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return Math.ceil((end.getTime() - Date.now()) / 86_400_000);
}

/** "12 days left · 21.10.2026", "ended 1.10.2026", or "no end date". */
export function passEndLabel(expiresAt: Date | null | undefined): string {
  if (!expiresAt) return "no end date";
  const left = passDaysLeft(expiresAt);
  if (left !== null && left > 0) {
    return `${left} day${left === 1 ? "" : "s"} left · ${expiresAt.toLocaleDateString()}`;
  }
  return `ended ${expiresAt.toLocaleDateString()}`;
}
