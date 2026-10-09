import type { ByokVendorId } from "@bitbaum/ai-kit/byok";

/**
 * What the settings screen knows about one key the user brought — the API's
 * view of a row, never the key itself (see api/settings/model/route.ts).
 */
export type OwnModelRow = {
  vendor: ByokVendorId;
  model: string;
  keyHint: string;
  verifiedAt: string;
  position: number;
};

/** One JSON request against /api/settings/model and its probe, with the
 *  server's own sentence as the thrown error. */
export async function ownModelRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
