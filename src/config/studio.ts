import { z } from "zod";
import { WebsiteBriefBody, normalizeWebsite } from "@/lib/website-brief";

export const STUDIO = {
  intakePath: "/api/studio-intake",
  portalPath: "/api/studio-portal",
  reviewPath: "/api/studio-review",
  partnersPath: "/api/studio-partners",
  recoverPath: "/api/studio-recover",
  maxBody: 32_000,
} as const;

export const StudioAccessKey = z.string().regex(/^spt_[A-Za-z0-9_-]{43}$/);
const publicUrl = z.string().trim().max(500).transform(normalizeWebsite).pipe(z.string());
const common = {
  requestId: z.uuid(),
  accessKey: StudioAccessKey,
  contact: z.union([z.email().max(200), z.literal("")]).default(""),
  company: z.string().max(200).default(""),
};
export const StudioIntake = z.discriminatedUnion("kind", [
  WebsiteBriefBody.extend({
    ...common,
    kind: z.literal("website"),
    target: z.enum(["studio", "partner"]),
    offerId: z.string().max(80).optional(),
    preferredPartnerId: z.uuid().optional(),
  }).strict(),
  z
    .object({
      ...common,
      kind: z.literal("partner"),
      website: z.union([publicUrl, z.literal("")]).default(""),
      changes: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export type StudioIntakeInput = z.infer<typeof StudioIntake>;

export const PartnerProfile = z
  .object({
    name: z.string().trim().min(1).max(100),
    headline: z.string().trim().min(1).max(300),
    url: publicUrl,
    rate: z.string().trim().min(1).max(200),
    availability: z.enum(["available", "limited", "unavailable"]),
  })
  .strict();
export type PartnerProfileInput = z.infer<typeof PartnerProfile>;
export const CourseAssessment = z
  .object({
    version: z.string().min(1).max(80),
    answers: z.record(z.string().regex(/^[a-z-]{1,80}$/), z.string().trim().min(30).max(2500)),
    projectUrl: publicUrl,
    sourceUrl: publicUrl,
  })
  .strict();
export type CourseAssessmentInput = z.infer<typeof CourseAssessment>;
/**
 * What a partner may state a fee in: what OrangeCat lists a service in. The
 * fee is the partner's own price for the agreed work, paid to the partner's
 * own wallet; Loki never holds it.
 */
export const FEE_CURRENCIES = ["CHF", "BTC", "EUR", "USD"] as const;
export type FeeCurrency = (typeof FEE_CURRENCIES)[number];
export const StudioFee = z
  .object({ amount: z.number().positive().max(1_000_000_000), currency: z.enum(FEE_CURRENCIES) })
  .strict();
export type StudioFeeInput = z.infer<typeof StudioFee>;
const mutation = { mutationId: z.uuid() };
const message = z.string().trim().min(1).max(2000);
const version = z.number().int().min(0);
const preview = {
  expectedVersion: version,
  previewUrl: publicUrl,
  scope: z.string().trim().min(10).max(2000),
  summary: z.string().trim().min(10).max(2000),
};
export const StudioGuestAction = z.discriminatedUnion("action", [
  z.object({ ...mutation, action: z.literal("message"), body: message }).strict(),
  z.object({ ...mutation, action: z.literal("set_contact"), contact: z.email().max(200) }).strict(),
  z.object({ ...mutation, action: z.literal("accept_preview"), version }).strict(),
  z.object({ ...mutation, action: z.literal("request_changes"), version, body: message }).strict(),
  z
    .object({ ...mutation, action: z.literal("submit_assessment"), assessment: CourseAssessment })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("propose_profile"),
      profile: PartnerProfile,
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("set_availability"),
      availability: PartnerProfile.shape.availability,
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("deliver_assignment"),
      requestId: z.uuid(),
      ...preview,
      /** Stated once per brief, with a delivery; listed in the partner's name on OrangeCat. */
      fee: StudioFee.optional(),
    })
    .strict(),
]);
export type StudioGuestInput = z.infer<typeof StudioGuestAction>;
export const StudioStaffAction = z.discriminatedUnion("action", [
  z.object({ ...mutation, action: z.literal("message"), body: message }).strict(),
  z
    .object({
      ...mutation,
      action: z.literal("set_status"),
      status: z.enum(["review", "needs_information", "in_progress", "closed"]),
      body: message,
    })
    .strict(),
  z.object({ ...mutation, action: z.literal("publish_preview"), ...preview }).strict(),
  z.object({ ...mutation, action: z.literal("link_project"), projectId: z.uuid() }).strict(),
  z
    .object({
      ...mutation,
      action: z.literal("review_course"),
      passed: z.boolean(),
      body: z.string().trim().min(10).max(2000),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("approve_partner"),
      body: z.string().trim().min(10).max(2000),
    })
    .strict(),
  z
    .object({
      ...mutation,
      action: z.literal("decline_partner"),
      body: z.string().trim().min(10).max(2000),
    })
    .strict(),
  z.object({ ...mutation, action: z.literal("publish_profile") }).strict(),
  z.object({ ...mutation, action: z.literal("assign_partner"), partnerId: z.uuid() }).strict(),
  z.object({ ...mutation, action: z.literal("revoke_access") }).strict(),
]);
export type StudioStaffInput = z.infer<typeof StudioStaffAction>;

export const STUDIO_STATUS = {
  waitlisted: [
    "On the studio waitlist",
    "The studio is at capacity. A reviewer will reply here when there is a next step; no start date is reserved.",
  ],
  review: ["Under review", "The studio is reviewing your brief. You can add context below."],
  needs_information: [
    "More information needed",
    "Read the review below and reply with the requested details.",
  ],
  in_progress: [
    "Work in progress",
    "The agreed work is being prepared. The next preview will appear here.",
  ],
  ready_for_review: [
    "Preview ready",
    "Review the preview and its stated scope, then accept this version or request changes.",
  ],
  changes_requested: ["Changes requested", "Your feedback is recorded for the next revision."],
  accepted: [
    "Preview accepted",
    "You accepted this preview version. Publication and production access are agreed separately.",
  ],
  closed: [
    "Request closed",
    "Read the closing note below. You can still reply if something needs clarification.",
  ],
  // A partner is approved on their work, by a person. The course is offered,
  // never required: a qualified builder with a portfolio is not sent to class,
  // and one who wants a credential can earn it. Applications made before
  // 2026-10-19 still carry the course-first statuses below; their words now
  // say the same thing.
  applied: [
    "Application received",
    "The studio reads what you have built and replies here. The systems design course is optional: take it if you want its credential on your profile.",
  ],
  course_in_progress: [
    "Application received",
    "The studio reads what you have built and replies here. The systems design course is optional: take it if you want its credential on your profile.",
  ],
  course_submitted: [
    "Course evidence under review",
    "A studio reviewer will assess your capstone against the published rubric. Your application does not wait on it.",
  ],
  course_passed: [
    "Course passed",
    "The credential will show on your profile. The studio still decides the application on your work as a whole.",
  ],
  approved: [
    "Partner approved",
    "Propose your public profile and availability. The studio reviews it before it appears in the directory.",
  ],
  declined: [
    "Application declined",
    "Read the reasons below. You can reply with more of your work for a new review.",
  ],
} as const;
export type StudioStatus = keyof typeof STUDIO_STATUS;
