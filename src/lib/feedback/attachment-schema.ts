import { z } from "zod";
import { MOMENT_LIMITS } from "../../../widget/moments-contract";
import { FeedbackCaptureContextSchema } from "./capture-context-schema";

/**
 * The attachments a report may carry — one definition for the widget's
 * POST /api/feedback and an agent's POST /api/projects/[id]/feedback, so the
 * two doors accept exactly the same screenshots, context and moments.
 */
export const FeedbackAttachmentsSchema = {
  context: FeedbackCaptureContextSchema.optional(),
  /** Client-downscaled images, data URLs only; the char cap bounds storage per image (~450 KB each). */
  screenshots: z
    .array(
      z
        .string()
        .regex(/^data:image\/(jpeg|png|webp);base64,/)
        .max(600_000),
    )
    .max(5)
    .optional(),
  selectedElements: z
    .array(
      z.object({
        elementType: z.string().max(100),
        elementText: z.string().max(300),
        selector: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
  /** What was seen while each thing was said (widget/moments-contract.ts holds the same limits). */
  moments: z
    .array(
      z.object({
        at: z.number().int().min(0).max(MOMENT_LIMITS.at),
        page: z.string().max(MOMENT_LIMITS.page),
        label: z.string().max(MOMENT_LIMITS.label),
        marked: z.boolean().optional(),
        scrollY: z.number().int().min(0).max(MOMENT_LIMITS.scrollY).optional(),
        text: z.string().max(MOMENT_LIMITS.text).optional(),
        tap: z
          .object({
            text: z.string().max(MOMENT_LIMITS.tapText),
            selector: z.string().max(MOMENT_LIMITS.selector),
          })
          .optional(),
        said: z.string().max(MOMENT_LIMITS.said).optional(),
      }),
    )
    .max(MOMENT_LIMITS.count)
    .optional(),
};
