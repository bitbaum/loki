/**
 * The one POST to /api/widget/self-report — the widget filing something
 * about ITSELF into Loki's own project (src/lib/widget/self-report.ts).
 * Fields are clamped to the route's caps: it rejects a whole report on one
 * character over, and a person's note would be lost with it.
 */

/** Mirror WIDGET_SELF_KINDS in src/lib/widget/self-report.ts. */
export type SelfKind = "note" | "error" | "request" | "slow" | "overflow";
/** Mirror WIDGET_SELF_DETAIL_MAX / WIDGET_SELF_NOTE_MAX. */
export const SELF_DETAIL_MAX = 600;
export const SELF_NOTE_MAX = 2000;

export async function sendSelfReport(
  apiBase: string,
  fields: {
    token: string;
    kind: SelfKind;
    detail?: string;
    note?: string;
    ownerPass?: string;
    screenshots?: string[];
  },
): Promise<{ building: boolean; note?: string; followUrl?: string; claimUrl?: string }> {
  const res = await fetch(`${apiBase}/api/widget/self-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: fields.token,
      kind: fields.kind,
      detail: fields.detail?.slice(0, SELF_DETAIL_MAX) || undefined,
      note: fields.note?.trim().slice(0, SELF_NOTE_MAX) || undefined,
      url: location.href.slice(0, 1000),
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      ownerPass: fields.ownerPass,
      screenshots: fields.screenshots?.length ? fields.screenshots : undefined,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    building?: boolean;
    buildNote?: string;
    followUrl?: string;
    claimUrl?: string;
  } | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return {
    building: body?.building === true,
    ...(body?.buildNote ? { note: body.buildNote.slice(0, 500) } : {}),
    ...(body?.followUrl ? { followUrl: body.followUrl.slice(0, 1000) } : {}),
    ...(body?.claimUrl ? { claimUrl: body.claimUrl.slice(0, 1000) } : {}),
  };
}
