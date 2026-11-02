import { z } from "zod";
import { NOTICE_URGENCIES } from "@/lib/notify/policy";
import { NOTIFY_CATEGORY_IDS } from "@/config/notify-categories";

/**
 * The wire shape every bot posts. Lenient on purpose: a notice the policy
 * refuses (no button, a long label) is still RECORDED in the list, with the
 * reason, so the sender's author can see why it never reached the phone.
 */
export const NoticeBody = z.object({
  source: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(400),
  body: z.string().trim().max(2000).optional(),
  actions: z
    .array(z.object({ label: z.string().trim().max(60), url: z.string().trim().max(2000) }))
    .max(6)
    .default([]),
  urgency: z.enum(NOTICE_URGENCIES).default("today"),
  key: z.string().trim().max(200).optional(),
  voice: z.boolean().optional(),
  /** Which kind of message (config/notify-categories.ts); each person chooses per kind. */
  category: z.enum(NOTIFY_CATEGORY_IDS).optional(),
  /** The incident is over: close its row, say nothing. */
  resolved: z.boolean().optional(),
});
export type NoticeBodyInput = z.infer<typeof NoticeBody>;
