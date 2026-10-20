import { pgTable, uuid, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const PLAN_VALUES = ["free", "personal", "pro", "team"] as const;
export type Plan = (typeof PLAN_VALUES)[number];

export const PLAN_STATUS_VALUES = ["active", "past_due", "canceled"] as const;
export type PlanStatus = (typeof PLAN_STATUS_VALUES)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  isDefault: boolean("is_default").default(false),
  /** A private builder on Loki's cloud: this account's own Linux user, home
   *  and runner unit on the box (scripts/hetzner/new-tenant.sh), reconciled
   *  from this flag. Grants cloud BUILDING only — never the founder's fleet
   *  powers (execution-access.ts isFleetInfrastructureAllowed). Switched on
   *  from System → Plans. docs/architecture/private-builders.md. */
  privateBuilder: boolean("private_builder").default(false).notNull(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  // Cross-product identity bridge — the linked OrangeCat actor (= OIDC
  // id_token.sub from "Login with OrangeCat"). Null = not linked. See
  // docs/architecture/cross-product-identity-bridge.md Part A.
  orangecatActorId: uuid("orangecat_actor_id").unique(),
  // Billing
  plan: text("plan").$type<Plan>().default("free").notNull(),
  planStatus: text("plan_status").$type<PlanStatus>(),
  // OrangeCat/Bitcoin-rail passes are time-boxed (BTC has no native recurring):
  // the entitlement webhook sets this to now + period, and the
  // downgrade-expired-plans cron reverts the plan to free once it passes. Null =
  // no expiry (free tier).
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  // Private-zone PIN — scrypt hash in `<hash>.<salt>` format. Null = no PIN
  // configured for this user; the gate stays open. Each user sets / changes
  // / disables their own PIN through Settings → Privacy.
  privateZonePinHash: text("private_zone_pin_hash"),
  privateZonePinSetAt: timestamp("private_zone_pin_set_at", { withTimezone: true }),
  /** Personal Start my day preferences live under startMyDay. Older runner
   * restoration keys are retired and remain unread. */
  fleetSettings: jsonb("fleet_settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
