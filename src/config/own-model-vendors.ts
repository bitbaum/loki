import type { ByokVendorId } from "@bitbaum/ai-kit/byok";

/**
 * Where a person funds a key and caps what it can spend, per vendor.
 *
 * ai-kit's vendor list (the SSOT for ids, hosts and key pages) carries no
 * billing page, and the one time a reader needed it — an xAI key the vendor
 * recognised but could not bill, 2026-10-10 — the screen said "didn't accept
 * this key" and stopped. A key that is right but unfunded is not a bad key;
 * it is a key one page away from working, and that page is this table.
 *
 * `limit` is the vendor's own word for the spending cap, so the sentence on
 * screen matches what the reader will find there. These are console
 * landing pages, which outlive their deeper paths; the deeper path is one
 * click in.
 */
export const OWN_MODEL_BILLING: Record<ByokVendorId, { billingUrl: string; limit: string }> = {
  openrouter: {
    billingUrl: "https://openrouter.ai/settings/credits",
    limit: "a credit limit per key",
  },
  openai: {
    billingUrl: "https://platform.openai.com/settings/organization/billing",
    limit: "a monthly budget",
  },
  anthropic: {
    billingUrl: "https://console.anthropic.com/settings/billing",
    limit: "a monthly spend limit",
  },
  google: { billingUrl: "https://aistudio.google.com/plan_information", limit: "a billing budget" },
  groq: { billingUrl: "https://console.groq.com/settings/billing", limit: "a monthly limit" },
  mistral: { billingUrl: "https://console.mistral.ai/billing", limit: "a spending limit" },
  deepseek: { billingUrl: "https://platform.deepseek.com/top_up", limit: "a prepaid balance" },
  xai: { billingUrl: "https://console.x.ai", limit: "a monthly spending limit" },
  together: { billingUrl: "https://api.together.ai/settings/billing", limit: "a prepaid balance" },
  cerebras: { billingUrl: "https://cloud.cerebras.ai", limit: "a monthly limit" },
};
