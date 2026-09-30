import { createHash, timingSafeEqual } from "node:crypto";
import { COMMISSION } from "@/config/commission";
import { StudioAccessKey } from "@/config/studio";

export function studioHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function studioBearer(request: Request): string | null {
  const match = /^Bearer (spt_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}
export function studioKeyMatches(key: string, hash: string): boolean {
  if (!StudioAccessKey.safeParse(key).success || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(studioHash(key), "hex"), Buffer.from(hash, "hex"));
}
export function studioOriginAllowed(request: Request, required = false): boolean {
  const origin = request.headers.get("origin");
  return origin === COMMISSION.studioOrigin || (!required && origin === null);
}
export function studioHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  if (request.headers.get("origin") === COMMISSION.studioOrigin) {
    headers.set("Access-Control-Allow-Origin", COMMISSION.studioOrigin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}
