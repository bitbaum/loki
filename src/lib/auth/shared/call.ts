import { sharedAuth, siteUrl } from "./runtime";

export interface SharedAnswer {
  status: number;
  body: Record<string, unknown>;
  cookies: string[];
}

/**
 * Run one AccountKit endpoint for this request. The caller's headers go along
 * unchanged (its cookies, and the proxy hop AccountKit's limiter keys on); only
 * the origin and the body are AccountKit's.
 */
export async function callShared(
  request: Request,
  route: string,
  body: Record<string, unknown>,
): Promise<SharedAnswer> {
  const origin = new URL(siteUrl()).origin;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("origin", origin);
  headers.set("content-type", "application/json");
  const response = await sharedAuth.POST(
    new Request(`${origin}/api/auth${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Nothing to translate.
  }
  return { status: response.status, body: parsed, cookies: response.headers.getSetCookie() };
}
