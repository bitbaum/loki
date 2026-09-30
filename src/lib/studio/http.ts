import { NextRequest, NextResponse } from "next/server";
import { jsonOk, jsonError } from "@/lib/api/route-helpers";
import { studioHeaders, studioOriginAllowed } from "./access";
import { StudioConflict } from "./policy";
import { StudioBodyTooLarge } from "./body";
import { DemoBlockedError } from "@/lib/demo-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { getStudioCommission } from "@/lib/studio-commission";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { COMMISSION } from "@/config/commission";

export function studioResponse(request: Request, data: Record<string, unknown>, status = 200) {
  return jsonOk(data, { status, headers: studioHeaders(request) });
}
export function studioError(request: Request, message: string, status: number) {
  const response = jsonError(message, status);
  studioHeaders(request).forEach((value, key) => response.headers.set(key, value));
  return response;
}
export function studioPreflight(request: Request) {
  return studioOriginAllowed(request, true)
    ? new NextResponse(null, { status: 204, headers: studioHeaders(request) })
    : studioError(request, "This origin is not allowed.", 403);
}
export function studioRateAllowed(request: NextRequest, family: string, count = 60) {
  return checkRateLimit(
    `studio:${family}:${getClientIp(request)}`,
    count,
    RATE_LIMIT_WINDOW_SHORT_MS,
  );
}
/** Resolve the fixed published studio owner. This is not caller authentication. */
export async function studioContext() {
  const contract = await getStudioCommission();
  if (!contract)
    throw new StudioConflict(
      "Studio terms could not be loaded. Your draft is still here; try again.",
      503,
    );
  const token = await getWidgetTokenByToken(contract.feedbackToken);
  if (
    !token ||
    token.status !== "active" ||
    (token.origins?.length && !token.origins.includes(COMMISSION.studioOrigin))
  )
    throw new StudioConflict(
      "Studio intake is unavailable. Your draft is still here; try again later.",
      503,
    );
  return { token, contract };
}
export function studioFailure(request: Request, error: unknown) {
  if (error instanceof StudioConflict) return studioError(request, error.message, error.status);
  if (error instanceof StudioBodyTooLarge)
    return studioError(request, "This request is too large. Shorten it and retry.", 413);
  if (error instanceof DemoBlockedError)
    return studioError(request, "Studio review is unavailable in the demo.", 403);
  console.error("studio request failed", error instanceof Error ? error.name : "unknown");
  return studioError(
    request,
    "The request did not complete. Your draft is still here; retry the same action.",
    500,
  );
}
