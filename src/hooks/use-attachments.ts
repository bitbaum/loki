"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTextFile } from "@bitbaum/chatkit";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_CHARS,
  MAX_IMAGE_BYTES,
  isImageMime,
  stripDataUrlBase64,
  type Attachment,
  type StagedAttachment,
} from "@/lib/loki/attachments";

/**
 * Staging screenshots and text files for a composer.
 *
 * Lifted out of the Loki composer, which had been the only surface in the app
 * that could take a picture — so "show the agent what's wrong" meant describing
 * a screenshot in words to a chat assistant, and the dispatch composers on
 * Control and Terminal, the two places you actually send work from, could not
 * take one at all.
 *
 * The parts worth keeping out of every caller: object-URL lifetimes (a preview
 * that is never revoked is a leak that survives every send), the dedupe key,
 * the size and count limits, and paste-to-attach — which on a phone is how a
 * screenshot arrives, and on a laptop is how everyone expects it to work.
 *
 * Limits and wire shape stay in lib/loki/attachments. A second opinion about
 * how large an image may be is how the two paths drift apart.
 */

/** Identity for dedupe and removal. Two files with the same name and the same
 *  bytes are the same attachment however they arrived (picker, paste, drop). */
function stageKey(a: StagedAttachment): string {
  return a.kind === "image"
    ? `image:${a.name}:${a.dataBase64.length}`
    : `text:${a.name}:${a.content.length}`;
}

export type AttachmentsController = {
  attachments: StagedAttachment[];
  /** Non-fatal explanation of something that did not attach (too big, wrong
   *  type, over the count). Never thrown — a rejected file must not lose the
   *  draft next to it. */
  note: string | null;
  clearNote: () => void;
  addFiles: (files: FileList | File[] | null) => void;
  /** Attach images from a paste event. Returns true if it consumed the paste,
   *  so the caller can preventDefault only when there was actually an image. */
  addFromPaste: (e: React.ClipboardEvent) => boolean;
  remove: (key: string) => void;
  clear: () => void;
  /** Strips preview URLs — the wire shape the API validates. */
  toWire: () => Attachment[];
  keyOf: (a: StagedAttachment) => string;
  full: boolean;
};

export function useAttachments(): AttachmentsController {
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const previewUrls = useRef<Set<string>>(new Set());

  // Revoke every preview still outstanding when the composer unmounts.
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const add = useCallback((item: StagedAttachment) => {
    setAttachments((prev) => {
      if (prev.length >= MAX_ATTACHMENTS) return prev;
      if (prev.some((p) => stageKey(p) === stageKey(item))) return prev;
      return [...prev, item];
    });
  }, []);

  const stageImage = useCallback(
    (file: File) => {
      if (!isImageMime(file.type)) {
        setNote(`${file.name}: use PNG, JPEG, GIF, or WebP.`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setNote(`${file.name} is too large (max ${Math.round(MAX_IMAGE_BYTES / 1_000_000)}MB).`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        add({
          kind: "image",
          name: file.name,
          mimeType: file.type,
          dataBase64: stripDataUrlBase64(String(reader.result ?? "")),
          previewUrl,
        });
      };
      reader.onerror = () => setNote(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    },
    [add],
  );

  const stageText = useCallback(
    (file: File) => {
      // Files takes anything (that is what keeps it the real document
      // browser), so a PDF must be turned away here, not read as text.
      if (!isTextFile(file.name, file.type)) {
        setNote(`${file.name}: attach an image (PNG, JPEG, GIF, WebP) or a text file.`);
        return;
      }
      if (file.size > MAX_ATTACHMENT_CHARS) {
        setNote(
          `${file.name} is too large (max ${Math.round(MAX_ATTACHMENT_CHARS / 1000)}k chars).`,
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        add({
          kind: "text",
          name: file.name,
          content: String(reader.result ?? "").slice(0, MAX_ATTACHMENT_CHARS),
        });
      reader.onerror = () => setNote(`Could not read ${file.name}.`);
      reader.readAsText(file);
    },
    [add],
  );

  // `count` mirrors attachments.length for the one thing an updater cannot do:
  // decide how many more files fit, from outside a render. Reading it from a
  // ref keeps addFiles free of a setState-inside-a-state-updater — a side
  // effect in a reducer, which React is entitled to run twice.
  const count = useRef(0);
  useEffect(() => {
    count.current = attachments.length;
  }, [attachments.length]);

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      setNote(null);
      const room = MAX_ATTACHMENTS - count.current;
      if (room <= 0) {
        setNote(`Up to ${MAX_ATTACHMENTS} files.`);
        return;
      }
      // Each stager appends asynchronously once its FileReader resolves; `add`
      // enforces the ceiling again there, so a burst cannot overshoot.
      for (const file of Array.from(files).slice(0, room)) {
        if (isImageMime(file.type)) stageImage(file);
        else stageText(file);
      }
    },
    [stageImage, stageText],
  );

  const addFromPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return false;
      const images = Array.from(items).filter((i) => i.type.startsWith("image/"));
      if (images.length === 0) return false;
      setNote(null);
      for (const item of images) {
        const file = item.getAsFile();
        if (file) stageImage(file);
      }
      return true;
    },
    [stageImage],
  );

  const remove = useCallback((key: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => stageKey(a) === key);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrls.current.delete(target.previewUrl);
      }
      return prev.filter((a) => stageKey(a) !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) {
        if (a.previewUrl) {
          URL.revokeObjectURL(a.previewUrl);
          previewUrls.current.delete(a.previewUrl);
        }
      }
      return [];
    });
    setNote(null);
  }, []);

  const toWire = useCallback(
    () => attachments.map(({ previewUrl: _preview, ...rest }) => rest as Attachment),
    [attachments],
  );

  return {
    attachments,
    note,
    clearNote: () => setNote(null),
    addFiles,
    addFromPaste,
    remove,
    clear,
    toWire,
    keyOf: stageKey,
    full: attachments.length >= MAX_ATTACHMENTS,
  };
}
