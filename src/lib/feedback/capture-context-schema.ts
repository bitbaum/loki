import { z } from "zod";
import {
  CAPTURE_CONTEXT_LIMITS,
  type FeedbackCaptureContext,
} from "../../../widget/capture-context";

export const FeedbackCaptureContextSchema: z.ZodType<FeedbackCaptureContext> = z
  .record(
    z.string().max(CAPTURE_CONTEXT_LIMITS.keyChars),
    z.union([
      z.string().max(CAPTURE_CONTEXT_LIMITS.valueChars),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  )
  .refine(
    (value) => Object.keys(value).length <= CAPTURE_CONTEXT_LIMITS.fields,
    "Too much page context",
  );
