import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";
import { widgetTokens } from "./widget-tokens";
import type { CourseAssessmentInput, PartnerProfileInput, StudioStatus } from "@/config/studio";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("studio_request_key").on(t.userId, t.requestKeyHash),
    index("studio_request_owner").on(t.userId, t.updatedAt),
    index("studio_request_partner").on(t.partnerId),
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
