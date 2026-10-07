import { COMMISSION, WEBSITE_MODE_IDS, type WebsiteMode } from "@/config/commission";
import { CONSULT_CHECK_IDS, type ConsultCheckId } from "@/config/site-consult";

/**
 * The /change draft — what survives sign-in (sessionStorage) and arrives from
 * the studio's handoff link (#brief=…). Parsed defensively: both sources are
 * text anyone can edit, so every field is checked and clipped, and a handoff
 * never carries a request id (it must not resume someone else's project).
 */
export type WebsiteDraft = {
  website: string;
  changes: string;
  requestId: string;
  mode: WebsiteMode;
  /** Fixes the person kept from the consultation; null = all it found. */
  fixes: ConsultCheckId[] | null;
};

export function parseWebsiteDraft(raw: string | null, fromHandoff: boolean): Partial<WebsiteDraft> {
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    value = parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Partial<WebsiteDraft> = {};
  if (typeof value.website === "string")
    out.website = value.website.slice(0, COMMISSION.maxWebsite);
  if (typeof value.changes === "string")
    out.changes = value.changes.slice(0, COMMISSION.maxChanges);
  if (WEBSITE_MODE_IDS.includes(value.mode as WebsiteMode)) out.mode = value.mode as WebsiteMode;
  if (
    Array.isArray(value.fixes) &&
    value.fixes.every((id) => CONSULT_CHECK_IDS.includes(id as ConsultCheckId))
  )
    out.fixes = value.fixes as ConsultCheckId[];
  if (!fromHandoff && typeof value.requestId === "string" && /^[a-f\d-]{36}$/.test(value.requestId))
    out.requestId = value.requestId;
  return out;
}

export function saveWebsiteDraft(draft: WebsiteDraft): void {
  try {
    sessionStorage.setItem(COMMISSION.draftKey, JSON.stringify(draft));
  } catch {
    /* Storage is optional. */
  }
}

export function clearWebsiteDraft(): void {
  try {
    sessionStorage.removeItem(COMMISSION.draftKey);
  } catch {
    /* Storage is optional. */
  }
}
