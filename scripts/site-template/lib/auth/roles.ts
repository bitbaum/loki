/**
 * What a person is to this product. One account, one role, held in the app's
 * own `users` table — customers, the people who help them, professionals,
 * staff and admins all sign in the same way (fleet STACK.md, "Identity").
 *
 * Adding a role is one line here. A role is never chosen by the person it
 * describes: sign-up ignores it, and only `pnpm run role:grant` changes it.
 */
export const ROLES = ["customer", "helper", "professional", "staff", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "customer";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Roles that may see other people's records. Everyone else sees only their own. */
const STAFF: readonly Role[] = ["staff", "admin"];

export function isStaff(role: unknown): boolean {
  return isRole(role) && STAFF.includes(role);
}

/** Only an admin may change roles, and nobody may change their own. */
export function mayGrantRole(actor: { id: string; role: unknown }, targetId: string): boolean {
  return actor.role === "admin" && actor.id !== targetId;
}
