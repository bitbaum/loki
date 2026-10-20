import type { NextRequest } from "next/server";
import { WIDGET_TOKEN_STATUS } from "@/lib/constants/statuses";
import { getWidgetTokenByToken } from "@/db/queries/widget-tokens";
import { passHolder } from "@/lib/feedback/pass-holder";
import { isWidgetOriginAllowed } from "@/lib/widget/origin";

type Token = NonNullable<Awaited<ReturnType<typeof getWidgetTokenByToken>>>;

/**
 * Who is asking, for every widget route that acts on the owner's pass: an
 * active token, an allowed origin, and a pass held by the project's owner or
 * an editor (lib/feedback/pass-holder.ts) — one test, so the routes that read
 * the owner's changes and the one that starts their saved notes cannot drift.
 * `stranger` is not an error: the widget forgets a pass the server refuses.
 */
export async function ownerRequest(
  req: NextRequest,
  data: { token: string; ownerPass: string },
): Promise<
  | { kind: "error"; status: number; error: string }
  | { kind: "stranger" }
  | { kind: "owner"; token: Token; holder: { userId: string } }
> {
  const token = await getWidgetTokenByToken(data.token);
  if (!token || token.status !== WIDGET_TOKEN_STATUS.ACTIVE)
    return { kind: "error", status: 403, error: "Unknown or revoked widget token" };
  const origin = req.headers.get("origin");
  if (!isWidgetOriginAllowed({ tokenOrigins: token.origins, origin, allowMissingOrigin: false }))
    return { kind: "error", status: 403, error: "Origin not allowed for this widget" };
  const holder = passHolder(data.ownerPass, token);
  return holder ? { kind: "owner", token, holder } : { kind: "stranger" };
}
