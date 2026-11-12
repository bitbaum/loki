/**
 * Whose cloud builder an account's "cloud" means.
 *
 * Builders are per account (docs/architecture/private-builders.md): the
 * fleet's own runner claims only its owner's work, and an account with a
 * private builder runs on its own sealed unit. Presence is read for the
 * asking account, so a seat whose private builder was not connected read
 * "Cloud runner offline" and "Cloud sessions are offline" while the fleet's
 * runner was up (QA seat walk, 2026-11-12). That was true of the seat's own
 * builder and read as false about the runner everyone could see working.
 *
 * - `fleet`: the account the box's runner works for (users.is_default);
 * - `private`: an account with its own builder (users.private_builder);
 * - `none`: no cloud builder at all; the cloud is private to others.
 */
export type CloudBuilderScope = "fleet" | "private" | "none";

export function cloudBuilderScope(
  user: { isDefault?: boolean | null; privateBuilder?: boolean | null } | null | undefined,
): CloudBuilderScope {
  if (user?.isDefault) return "fleet";
  if (user?.privateBuilder) return "private";
  return "none";
}
