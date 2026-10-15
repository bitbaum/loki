"use client";

import { useState } from "react";
import type { TextAttachment } from "@/lib/loki/attachments";
import { fetchFeedbackFile, noFeedbackYet } from "@/lib/feedback/fetch-export";

/** A file Loki put on the box from its own records, with what it holds. */
export type LokiFile = TextAttachment & { summary: string };

/**
 * Files from Loki's own records that ride along with the next message — the
 * project's feedback reports, so far. The agent cannot reach Loki's database;
 * this is how what Loki knows gets to it, one visible file at a time, only
 * when the person asks for it.
 */
export function useLokiAttachments(project: string | null) {
  const [files, setFiles] = useState<LokiFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Once Loki has said there are none, the box stops offering them.
  const [knownEmpty, setKnownEmpty] = useState(false);

  /**
   * Attach the feedback reports. Resolves true when a file was attached.
   * Asked for on its own, an empty file is not worth a chip — the note says
   * there are none. A prompt that names "the attached file" (`evenIfEmpty`)
   * gets it anyway, so what it says stays true.
   */
  const attachFeedback = async (evenIfEmpty = false): Promise<boolean> => {
    if (!project) return false;
    setBusy(true);
    setNote(null);
    const got = await fetchFeedbackFile(project);
    setBusy(false);
    if (!got.ok) {
      setNote(got.reason);
      return false;
    }
    setKnownEmpty(got.count === 0);
    if (got.count === 0 && !evenIfEmpty) {
      setNote(noFeedbackYet(project));
      return false;
    }
    const summary =
      got.count === 0
        ? "no reports yet"
        : got.included < got.count
          ? `${got.included} of ${got.count} reports, newest first`
          : `${got.count} report${got.count === 1 ? "" : "s"}`;
    const file: LokiFile = { ...got.file, summary };
    setFiles((all) => [...all.filter((f) => f.name !== file.name), file]);
    return true;
  };

  return {
    files,
    busy,
    knownEmpty,
    note,
    clearNote: () => setNote(null),
    attachFeedback,
    remove: (name: string) => setFiles((all) => all.filter((f) => f.name !== name)),
    clear: () => setFiles([]),
  };
}
