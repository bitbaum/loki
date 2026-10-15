import type { TextAttachment } from "@/lib/loki/attachments";

export type FeedbackFile =
  | { ok: true; file: TextAttachment; count: number; included: number }
  | { ok: false; reason: string };

/**
 * The project's feedback reports as a file to attach (GET /api/feedback/export,
 * lib/feedback/agent-export). Every way a prompt reaches an agent uses this one
 * reader, so the words a person sees on failure are the same everywhere.
 */
export async function fetchFeedbackFile(project: string): Promise<FeedbackFile> {
  try {
    const res = await fetch(`/api/feedback/export?project=${encodeURIComponent(project)}`);
    const data = (await res.json().catch(() => ({}))) as {
      file?: TextAttachment;
      count?: number;
      included?: number;
      error?: string;
    };
    if (!res.ok || !data.file) {
      return { ok: false, reason: data.error ?? "Loki could not read the feedback reports." };
    }
    // An empty file is still returned: a prompt that promises "the attached
    // file" keeps that promise, and the file itself says there are none.
    // Callers that attach on request say so instead (noFeedbackYet).
    const count = data.count ?? 0;
    return {
      ok: true,
      file: { ...data.file, kind: "text" },
      count,
      included: data.included ?? count,
    };
  } catch {
    return {
      ok: false,
      reason: "Loki could not read the feedback reports. Check the connection and try again.",
    };
  }
}

/** What to say when someone asks for the reports and there are none. */
export function noFeedbackYet(project: string): string {
  return `Loki holds no feedback reports for ${project} yet, so there is nothing to attach.`;
}
