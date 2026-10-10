import type { StoreModel } from "@/lib/models/store-catalog";

/** "$2 in · $6 out per 1M tokens", "free", or "varies" for a router. Pure. */
export function priceLabel(m: Pick<StoreModel, "inPerM" | "outPerM" | "free">): string {
  if (m.free) return "free";
  if (m.inPerM === null || m.outPerM === null) return "varies";
  return `$${money(m.inPerM)} in · $${money(m.outPerM)} out`;
}

export function money(perM: number): string {
  if (perM >= 10) return perM.toFixed(0);
  if (perM >= 1) return perM.toFixed(2).replace(/\.?0+$/, "");
  return perM.toFixed(3).replace(/\.?0+$/, "");
}

/** "1M ctx", "200k ctx", or "". Pure. */
export function contextLabel(context: number | null): string {
  if (!context) return "";
  if (context >= 1_000_000) {
    const m = context / 1_000_000;
    // 1,048,576 is "1M" to a person, 1.5M is "1.5M".
    return `${Number.isInteger(Math.round(m * 10) / 10) || m < 1.05 ? Math.round(m) : Math.round(m * 10) / 10}M ctx`;
  }
  return `${Math.round(context / 1000)}k ctx`;
}
