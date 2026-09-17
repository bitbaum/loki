import { db } from "@/db";
import { newsletterSubscribers } from "@/db/schema";

/**
 * Idempotent subscribe — the ONLY write path to newsletter_subscribers.
 * Normalizes the email here so the unique constraint on `email` is
 * effectively case-insensitive. A repeat signup (any casing) is a silent
 * no-op: the visitor asked to be on the list and they are — that is success.
 */
export async function subscribeToNewsletter(email: string, source: string): Promise<boolean> {
  const inserted = await db
    .insert(newsletterSubscribers)
    .values({ email: email.trim().toLowerCase(), source })
    .onConflictDoNothing()
    .returning({ id: newsletterSubscribers.id });
  // True only for a genuinely NEW row, so a caller can announce once. The
  // visitor is told the same thing either way — see the note above.
  return inserted.length > 0;
}
