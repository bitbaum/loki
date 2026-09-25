import { z } from "zod";
import { DOC_PASTE_MAX } from "@/lib/constants";

/** The message a too-long paste gets. It names the limit, so it can be acted
 *  on — the old routes collapsed "too long" into "at least a sentence". */
export const PASTE_TOO_LONG = `That is longer than ${DOC_PASTE_MAX.toLocaleString("en-US")} characters. Paste the part that matters most, or sync it in two passes.`;

/** One schema for every pasted document the AI reads (brief, roadmap,
 *  reconcile): trimmed, at least a sentence, at most DOC_PASTE_MAX, and each
 *  failure says which. */
export function pastedText(tooShort: string) {
  return z.string().trim().min(10, tooShort).max(DOC_PASTE_MAX, PASTE_TOO_LONG);
}
