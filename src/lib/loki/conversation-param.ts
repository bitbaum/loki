import { isValidUuid } from "@/lib/utils";

/** `?c=` → the conversation to reopen, or null for anything that is not an id. */
export function conversationIdFromParam(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v && isValidUuid(v) ? v : null;
}
