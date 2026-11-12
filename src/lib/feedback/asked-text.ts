/**
 * A filed report, without the machine tail an agent appends to it.
 *
 * Reports filed by Loki's own watch mode end in "--- technical details ---",
 * then the failing request, "filed by:", and a step log ("step 1: tap div …").
 * That tail is for the agent that fixes it. Quoted back to the person who
 * runs the product it read as noise or as an error, and the chat showed it
 * under "Asked" while the feedback board already left it out (owner audit,
 * 2026-11-12). One helper, so the board and the chat quote a report the same.
 */
export function withoutTechnicalTail(text: string): string {
  return text.split(/\s*---\s*technical details/i)[0] ?? text;
}
