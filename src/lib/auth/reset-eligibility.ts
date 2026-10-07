import { mayReceivePasswordReset } from "@bitbaum/accountkit/orangecat";

/**
 * Whether "forgot password" may email this Loki account a reset link.
 *
 * Loki's own rule stays: an account GitHub or Google created has no password,
 * and a reset link to its (provider-verified) address lets the owner add email
 * sign-in. What it must never do is the same for an account ONLY OrangeCat
 * created: that address came from OrangeCat unverified, so the link would hand
 * whoever owns it a password on the OrangeCat person's account. The shared
 * rule is @bitbaum/accountkit/orangecat's mayReceivePasswordReset.
 */
export function lokiMayReceivePasswordReset(
  user: { email: string | null; passwordHash: string | null; orangecatActorId: string | null },
  /** Providers of the user's linked accounts rows. */
  linkedProviders: readonly string[],
): boolean {
  const viaOrangecat = Boolean(user.orangecatActorId) || linkedProviders.includes("orangecat");
  const viaOther = linkedProviders.some((p) => p !== "orangecat");
  return mayReceivePasswordReset({
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    orangecatLinked: viaOrangecat && !viaOther,
  });
}
