/**
 * How many times an approved calendar event may fail to book before Loki stops
 * and tells the operator.
 *
 * A failed booking used to go straight back into the queue, and the drain
 * polls every 15 s. One event whose date lived only in its description
 * ("Schabernack @ Schneiderei", approved 2026-09-21) therefore failed 38,851
 * times in a week, asked the shared free model to rescue the date on every
 * pass, and never once told anyone it had not been booked. A transient `gog`
 * hiccup deserves a retry; the same failure three times in a row is a fact
 * about the event, and the right move is a message to a person.
 */
export const MAX_BOOKING_ATTEMPTS = 3;

export type BookingVerdict = "retry" | "give_up";

/** `failures` counts the failure being reported now. */
export function bookingVerdict(failures: number): BookingVerdict {
  return failures >= MAX_BOOKING_ATTEMPTS ? "give_up" : "retry";
}
