/** Pure contract: the embed imports these limits without a validation-library bundle. */
export const CAPTURE_CONTEXT_LIMITS = { fields: 10, keyChars: 80, valueChars: 300 } as const;
export type FeedbackCaptureContext = Record<string, string | number | boolean | null>;
