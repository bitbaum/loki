/**
 * What of a user row may reach that user's own browser.
 *
 * `GET /api/me` returned the Drizzle row verbatim, so every authenticated page
 * load handed the client `passwordHash` and `privateZonePinHash`. Both are the
 * user's own — this is not a cross-account leak — but a credential digest in a
 * page response is reachable by anything the page is reachable by: an extension,
 * an XSS, a logging proxy, a screenshot of devtools. The PIN hash is the sharper
 * end: it guards the private zone and protects a short numeric secret, so an
 * offline attempt against it is cheap in a way a password hash is not.
 *
 * The list is an ALLOW-list, and both halves are exhaustive over the schema —
 * `scripts/test/user-client-view.ts` fails until every column in `users` is
 * named as exposed or withheld. A deny-list would be blind to the column added
 * tomorrow, which is the one that ships.
 *
 * "Exposed" means *reviewed and judged safe for the owner's own browser* — not
 * "must be sent". Narrowing it further is a change to this file only.
 */
import type { User } from "@/db/schema/users";

export const USER_CLIENT_FIELDS = [
  "id",
  "name",
  "email",
  "emailVerified",
  "image",
  "username",
  "isDefault",
  "privateBuilder",
  "buildEngine",
  "onboardedAt",
  "orangecatActorId",
  "plan",
  "planStatus",
  "planExpiresAt",
  // Not the PIN itself — only whether/when one was set, which Settings shows.
  "privateZonePinSetAt",
  "fleetSettings",
  "createdAt",
  "updatedAt",
] as const satisfies ReadonlyArray<keyof User>;

/** Withheld, each with the reason it can never be sent. */
export const USER_WITHHELD_FIELDS: Readonly<Partial<Record<keyof User, string>>> = {
  passwordHash:
    "credential digest — nothing in the browser can use it, anything in the browser could take it",
  privateZonePinHash:
    "scrypt digest of a short numeric PIN — low entropy makes an offline attempt cheap",
};

export type ClientUser = Pick<User, (typeof USER_CLIENT_FIELDS)[number]>;

/** Project a user row down to what its owner's browser may see. */
export function toClientUser(user: User): ClientUser {
  const out = {} as Record<string, unknown>;
  for (const field of USER_CLIENT_FIELDS) out[field] = user[field];
  return out as ClientUser;
}

/**
 * Billing identifiers are safe for the owner's own page — Settings renders plan
 * state from them — but the account export deliberately leaves them out: it is a
 * file that gets saved, mailed and pasted, and a Stripe id is a handle into a
 * third-party account rather than data the user authored.
 *
 * This is the only difference between the two projections. It is a *policy*
 * narrowing of the allow-list, never a second answer to what is secret — that
 * question has one answer, USER_WITHHELD_FIELDS, and both projections inherit it.
 */
export const USER_EXPORT_OMITTED_FIELDS = [] as const satisfies ReadonlyArray<
  (typeof USER_CLIENT_FIELDS)[number]
>;

export type ExportUser = Omit<ClientUser, (typeof USER_EXPORT_OMITTED_FIELDS)[number]>;

/** Project a user row down to what may leave the server in a downloaded file. */
export function toExportUser(user: User): ExportUser {
  const omitted = new Set<string>(USER_EXPORT_OMITTED_FIELDS);
  const out = {} as Record<string, unknown>;
  for (const field of USER_CLIENT_FIELDS) {
    if (!omitted.has(field)) out[field] = user[field];
  }
  return out as ExportUser;
}
