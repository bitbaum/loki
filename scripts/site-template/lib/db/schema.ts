/**
 * Every table this app owns. The schema is the SSOT: types come from
 * `$inferSelect`, migrations from `pnpm run db:generate`.
 *
 * ── Accounts ─────────────────────────────────────────────────────────────────
 * This app OWNS its accounts (fleet STACK.md, "Identity", 2026-10-11). A person
 * registers here without any other bitbaum product; "Sign in with OrangeCat"
 * and the shared bitbaum sign-in are two methods among several, recorded as
 * rows in `accounts` like a password is.
 *
 * Column shapes are what better-auth 1.x and its passkey and two-factor plugins
 * expect. Drift here does not fail the build — it fails at sign-in — so the
 * integration test (lib/auth/auth.integration.test.ts) drives every method
 * against a real Postgres built from drizzle/.
 *
 * Pseudonymous by default: `name` is a display name the person chooses, may be
 * empty, and is never required to be real. A sign-in method that brings no
 * email (OrangeCat, the shared sign-in) gets an address under `.invalid` — a
 * reserved name that can never receive mail and never collides with a real one
 * (see lib/auth/methods.ts).
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { DEFAULT_ROLE } from "@/lib/auth/roles";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /**
   * What this person is to the product — see lib/auth/roles.ts. Never set by
   * the person themselves: better-auth is told `input: false`, so a sign-up
   * body carrying `role: "admin"` is ignored. Change it with
   * `pnpm run role:grant`.
   */
  role: text("role").notNull().default(DEFAULT_ROLE),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  ...timestamps,
});

export const session = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    // Left empty on purpose: IP tracking is switched off (lib/auth/server.ts).
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Provider tokens are never kept: this app only needs to know WHO signed
    // in, not to act at the provider on their behalf (lib/auth/server.ts).
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** A slow, salted hash (scrypt). Never a plaintext secret. */
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    // One local person per provider identity.
    uniqueIndex("accounts_provider_account_uidx").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const passkey = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull().unique(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("passkeys_user_id_idx").on(t.userId)],
);

export const twoFactor = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey(),
    /** Encrypted by better-auth with BETTER_AUTH_SECRET before it is stored. */
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    index("two_factors_user_id_idx").on(t.userId),
    index("two_factors_secret_idx").on(t.secret),
  ],
);

/**
 * A person's own model key (fleet SHARED.md, "Your own model"). The key is
 * SEALED (AES-256-GCM, ai-kit `sealSecret`) with SECRET_SEAL_KEY before it is
 * written; no API ever returns it — only `hint` (…abcd).
 */
export const modelKey = pgTable("model_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  vendor: text("vendor").notNull(),
  model: text("model").notNull(),
  sealedKey: text("sealed_key").notNull(),
  hint: text("hint").notNull(),
  ...timestamps,
});

export type User = typeof user.$inferSelect;
export type ModelKey = typeof modelKey.$inferSelect;
