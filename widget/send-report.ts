/**
 * The one POST to Loki's feedback ingest. The panel's Send and Watch's
 * automatic fix both file through it, so the clamps and the error reading
 * exist once.
 *
 * Every field is clamped to the server's own cap (api/feedback/route.ts
 * FeedbackBody — scripts/test/widget-server-caps-mirror.ts compares them). The
 * ingest rejects the WHOLE submission with a bare "Invalid submission" naming
 * no field, so one character over a cap silently loses someone's report.
 */
import type { SelectedEl } from "./picker";

export type ReportFields = {
  token: string;
  suggestion: string;
  contact?: string;
  scope: "element" | "page" | "site";
  screenshots?: string[];
  selectedElements?: SelectedEl[];
  ownerPass?: string;
};

export type ReportAnswer = {
  claimUrl?: string;
  owner?: boolean;
  building?: boolean;
  buildNote?: string;
};

/** File a report about the page the person is on. Throws the server's own
 *  words when it refuses, so the panel can show them. */
export async function sendReport(apiBase: string, fields: ReportFields): Promise<ReportAnswer> {
  const res = await fetch(`${apiBase}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...fields,
      contact: fields.contact?.trim().slice(0, 200) || undefined,
      page: location.pathname.slice(0, 300),
      url: location.href.slice(0, 1000),
      pageTitle: document.title.slice(0, 300) || undefined,
      screenshots: fields.screenshots?.length ? fields.screenshots : undefined,
      selectedElements: fields.selectedElements?.length ? fields.selectedElements : undefined,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as ReportAnswer;
}
