import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";
import { widgetTokens } from "./widget-tokens";
import type {
  CourseAssessmentInput,
  FeeCurrency,
  PartnerProfileInput,
  StudioStatus,
} from "@/config/studio";
import type { StudioCommissionContract } from "@/lib/studio-commission";

/** Guest capability covers one request, never a project or agent credential. */
export const studioRequests = pgTable(
  "studio_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studioProjectId: uuid("studio_project_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => widgetTokens.id, { onDelete: "cascade" }),
    requestKeyHash: text("request_key_hash").notNull(),
    accessKeyHash: text("access_key_hash").notNull(),
    intakeHash: text("intake_hash").notNull(),
    accessRevoked: boolean("access_revoked").notNull().default(false),
    kind: text("kind").$type<"website" | "partner">().notNull(),
    target: text("target").$type<"studio" | "partner" | "application">().notNull(),
    website: text("website").notNull().default(""),
    changes: text("changes").notNull(),
    contact: text("contact"),
    status: text("status").$type<StudioStatus>().notNull(),
    projectId: uuid("project_id").references(() => entities.id, { onDelete: "set null" }),
    partnerId: uuid("partner_id").references((): AnyPgColumn => studioRequests.id, {
      onDelete: "set null",
    }),
    preferredPartnerId: uuid("preferred_partner_id").references(
      (): AnyPgColumn => studioRequests.id,
      { onDelete: "set null" },
    ),
    offerSnapshot: jsonb("offer_snapshot").$type<StudioCommissionContract["offer"]>(),
    deliveryVersion: integer("delivery_version").notNull().default(0),
    previewUrl: text("preview_url"),
    scope: text("scope"),
    deliverySummary: text("delivery_summary"),
    approvedVersion: integer("approved_version"),
    previewAcceptedAt: timestamp("preview_accepted_at", { withTimezone: true }),
    assessment: jsonb("assessment").$type<CourseAssessmentInput>(),
    coursePassedAt: timestamp("course_passed_at", { withTimezone: true }),
    partnerApprovedAt: timestamp("partner_approved_at", { withTimezone: true }),
    proposedProfile: jsonb("proposed_profile").$type<PartnerProfileInput>(),
    profileConsentAt: timestamp("profile_consent_at", { withTimezone: true }),
    profilePublishedAt: timestamp("profile_published_at", { withTimezone: true }),
    /**
     * The OrangeCat identity an approved partner connected (id_token.sub, the
     * same value as users.orangecat_actor_id). Lets them sign in to get their
     * application back without the private link, and ties a public profile
     * to one person. Never set before approval; applying needs no account.
     */
    orangecatActorId: uuid("orangecat_actor_id"),
    /**
     * On a website brief: the Loki account of the assigned partner — the
     * person whose users.orangecat_actor_id is the partner's connected actor.
     * The holder of the seat on the linked project; resolved at assignment,
     * null while the partner has not signed in to Loki (lib/studio/seat.ts).
     */
    builderUserId: uuid("builder_user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * The fee the partner states with a delivery, listed as a service in the
     * partner's OWN name on OrangeCat (fee_service_id, fee_url) with the
     * partner's token, so paying it pays the partner's wallet, never the
     * studio's. fee_paid_at is set only by OrangeCat's settled-payment signal
     * (/api/orangecat/events). NUMERIC(20,8): a fee may be in BTC.
     */
    feeAmount: numeric("fee_amount", { precision: 20, scale: 8, mode: "number" }),
    feeCurrency: text("fee_currency").$type<FeeCurrency>(),
    feeServiceId: text("fee_service_id"),
    feeUrl: text("fee_url"),
    feePaidAt: timestamp("fee_paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("studio_request_key").on(t.userId, t.requestKeyHash),
    index("studio_request_owner").on(t.userId, t.updatedAt),
    index("studio_request_partner").on(t.partnerId),
    index("studio_request_orangecat").on(t.orangecatActorId),
    index("studio_request_fee_service").on(t.feeServiceId),
  ],
);
export const studioRequestEvents = pgTable(
  "studio_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => studioRequests.id, { onDelete: "cascade" }),
    mutationId: uuid("mutation_id").notNull(),
    mutationHash: text("mutation_hash").notNull(),
    actor: text("actor").$type<"customer" | "partner" | "studio">().notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    deliveryVersion: integer("delivery_version"),
    visible: boolean("visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("studio_request_mutation").on(t.requestId, t.mutationId),
    index("studio_request_history").on(t.requestId, t.createdAt),
  ],
);
export type StudioRequest = typeof studioRequests.$inferSelect;
export type StudioRequestEvent = typeof studioRequestEvents.$inferSelect;
