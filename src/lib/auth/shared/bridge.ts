/**
 * Loki's screens on the shared runtime, unchanged.
 *
 * The pages use `next-auth/react` (signIn, signOut, useSession, update). With
 * AUTH_RUNTIME=accountkit those calls are answered here from AccountKit, so no
 * page has to learn a second protocol. AccountKit owns every session and its
 * limiter; Loki's own sign-up, invites, reset and password change keep writing
 * `users`, and the mirror triggers carry that to the shared row
 * (docs/architecture/accountkit-migration.md).
 *
 * GitHub, Google and X are Auth.js providers. AccountKit reaches them only
 * through the bitbaum sign-in (SIGNIN_*), so on this runtime they are not
 * offered; their buttons hide because the sign-in page asks
 * getEnabledAuthProviders, which knows the runtime.
 */
import { NextResponse } from "next/server";
import { orangecatOidc } from "@bitbaum/accountkit/auth";
import { ORANGECAT_PROVIDER_ID } from "@bitbaum/accountkit/orangecat";
import { ROUTES } from "@/config/auth";
import { getDefaultUser, getUserById } from "@/db/queries/users";
import { logDebug } from "@/db/queries/debug-logs";
import { bootstrapAfterSignIn } from "../bootstrap";
import { callShared } from "./call";
import { siteUrl } from "./runtime";
import { sharedSessionFor } from "./session";

type CredentialsProvider = "email-password" | "user-password" | "local";

/**
 * AccountKit endpoints reached directly: the session, and what the OrangeCat
 * round-trip needs. Its sign-up, reset and password endpoints stay closed until
 * Loki adopts AccountKit's screens: a second credential writer would put
 * hashes in `auth_accounts` that `users` never sees.
 */
function open(path: string): boolean {
  return (
    ["/get-session", "/sign-in/email", "/sign-out", "/ok", "/error"].includes(path) ||
    path.startsWith("/oauth2/callback/")
  );
}

function withCookies(response: NextResponse, setCookies: string[]) {
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}

/** What next-auth/react reads on a refusal: `error` (and `code`) in the returned URL. */
const refusal = (code: string) =>
  NextResponse.json({
    url: `${siteUrl()}${ROUTES.SIGN_IN}?error=CredentialsSignin&code=${code}`,
  });

/** A same-origin path from the client's callbackUrl, or `fallback`. */
export function landing(callbackUrl: FormDataEntryValue | null | undefined, fallback = "/") {
  const raw = typeof callbackUrl === "string" ? callbackUrl : "";
  const origin = new URL(siteUrl()).origin;
  try {
    const url = new URL(raw || fallback, origin);
    if (url.origin !== origin) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

/** The methods the pages may use on this runtime. */
export function providers(env: Record<string, string | undefined> = process.env) {
  const entry = (id: string, name: string, type: string) => ({
    id,
    name,
    type,
    signinUrl: `${siteUrl()}/api/auth/signin/${id}`,
    callbackUrl: `${siteUrl()}/api/auth/callback/${id}`,
  });
  return {
    ...(orangecatOidc(env)
      ? { [ORANGECAT_PROVIDER_ID]: entry(ORANGECAT_PROVIDER_ID, "OrangeCat", "oidc") }
      : {}),
    "email-password": entry("email-password", "Email and password", "credentials"),
    "user-password": entry("user-password", "User password", "credentials"),
    ...(env.ENABLE_OWNER_KEY === "1"
      ? { local: entry("local", "Local access", "credentials") }
      : {}),
  };
}

/** The address a credentials provider signs in, or null to refuse. */
async function addressFor(provider: CredentialsProvider, form: FormData | null) {
  if (provider === "email-password") {
    return (
      String(form?.get("email") ?? "")
        .trim()
        .toLowerCase() || null
    );
  }
  if (provider === "user-password") {
    const userId = String(form?.get("userId") ?? "");
    return userId ? ((await getUserById(userId))?.email ?? null) : null;
  }
  // The owner key: only with the explicit opt-in, and only the stored hash.
  // An env-only LOCAL_AUTH_PASSWORD install stays on Auth.js.
  if (process.env.ENABLE_OWNER_KEY !== "1") return null;
  return (await getDefaultUser())?.email ?? null;
}

async function credentialSignIn(request: Request, provider: CredentialsProvider) {
  const form = await request.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const email = await addressFor(provider, form);
  if (!email || !password) return refusal("credentials");
  const answer = await callShared(request, "/sign-in/email", { email, password });
  if (answer.status !== 200) {
    logDebug({
      source: "auth.authorize",
      level: "warn",
      message: `credentials rejected: ${provider} / accountkit ${answer.status}`,
      meta: { provider, identifier: email },
    });
    if (answer.status === 429) return refusal("rate_limited");
    if (answer.status >= 500) return refusal("unavailable");
    return refusal("credentials");
  }
  const user = answer.body.user as { id?: string; name?: string } | undefined;
  if (user?.id) await bootstrapAfterSignIn({ id: user.id, name: user.name, email });
  return withCookies(
    NextResponse.json({ url: `${siteUrl()}${landing(form?.get("callbackUrl"))}` }),
    answer.cookies,
  );
}

/**
 * "Sign in with OrangeCat" signed out; "Connect OrangeCat" (or Reconnect)
 * signed in, which links the identity to that session's person and refreshes
 * its stored tokens.
 */
export async function orangecatSignIn(request: Request, next: string) {
  const signedIn = await sharedSessionFor(request.headers);
  const answer = await callShared(request, signedIn ? "/oauth2/link" : "/sign-in/oauth2", {
    providerId: ORANGECAT_PROVIDER_ID,
    callbackURL: `${siteUrl()}${next}`,
    errorCallbackURL: `${siteUrl()}${signedIn ? next : ROUTES.SIGN_IN}?error=OAuthSignin`,
  });
  const url = typeof answer.body.url === "string" ? answer.body.url : null;
  return { url, cookies: answer.cookies };
}

/**
 * Auth.js's client protocol, answered by the shared runtime. Returns null for
 * an AccountKit path Loki uses, which then goes to AccountKit itself.
 */
export async function nextAuthClientCompat(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  // GET reads the session; POST is useSession().update(), which needs nothing
  // carried: the session is re-read from the database on every request.
  if (path === "/session" && (request.method === "GET" || request.method === "POST")) {
    return NextResponse.json(await sharedSessionFor(request.headers), {
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (request.method === "GET" && path === "/csrf") {
    // AccountKit checks the request origin itself; the client only needs a value.
    return NextResponse.json({ csrfToken: "accountkit" });
  }
  if (request.method === "GET" && path === "/providers") {
    return NextResponse.json(providers());
  }
  if (request.method === "GET" && path === `/signin/${ORANGECAT_PROVIDER_ID}`) {
    // The server-side signIn (src/auth.ts) arrives here by redirect. Only a
    // navigation Loki itself started may begin a round-trip that can link.
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") {
      return NextResponse.redirect(`${siteUrl()}${ROUTES.SIGN_IN}`);
    }
    const next = landing(new URL(request.url).searchParams.get("callbackUrl"));
    const { url, cookies } = await orangecatSignIn(request, next);
    if (!url) return NextResponse.redirect(`${siteUrl()}${ROUTES.SIGN_IN}?error=OAuthSignin`);
    return withCookies(NextResponse.redirect(url), cookies);
  }
  if (request.method === "GET" && path === "/signin") {
    // next-auth/react sends a provider this runtime does not offer here.
    return NextResponse.redirect(`${siteUrl()}${ROUTES.SIGN_IN}?error=OAuthSignin`);
  }
  if (request.method === "POST" && path === "/signout") {
    const form = await request.formData().catch(() => null);
    const answer = await callShared(request, "/sign-out", {});
    const next = `${siteUrl()}${landing(form?.get("callbackUrl"), ROUTES.SIGN_IN)}`;
    return withCookies(NextResponse.json({ url: next }), answer.cookies);
  }
  const credentials = /^\/callback\/(email-password|user-password|local)$/.exec(path);
  if (request.method === "POST" && credentials) {
    return credentialSignIn(request, credentials[1] as CredentialsProvider);
  }
  if (request.method === "POST" && path === `/signin/${ORANGECAT_PROVIDER_ID}`) {
    const form = await request.formData().catch(() => null);
    const { url, cookies } = await orangecatSignIn(request, landing(form?.get("callbackUrl")));
    if (!url) return refusal("unavailable");
    return withCookies(NextResponse.json({ url }), cookies);
  }
  if (open(path)) return null;
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
