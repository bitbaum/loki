/**
 * Where an update's pictures are served from. Chat messages carry a PATH, never
 * the bytes: a report's screenshot is up to 600k characters of data URL, and a
 * thread is read whole (getConversationWithMessages), so inlining one per
 * update would make every busy updates thread megabytes to open.
 */
export function feedbackScreenshotPath(feedbackId: string, n: number): string {
  return `/api/feedback/${feedbackId}/screenshot/${n}`;
}
