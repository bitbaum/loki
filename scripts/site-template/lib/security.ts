/**
 * The security headers, in one place. Products built from this starter hold
 * the most private things people have — legal letters, health, money — so the
 * browser is told to trust as little as possible:
 *
 *  - scripts only from this origin, and only those carrying this response's
 *    nonce (`strict-dynamic` lets those load their own chunks, nothing else);
 *  - network requests only to this origin (`connect-src 'self'`): a script
 *    that slipped in still has nowhere to send what it read;
 *  - no framing (clickjacking), no plugins, no <base> rewriting, forms post
 *    only here;
 *  - HTTPS only, for two years, subdomains included;
 *  - no referrer leaves the site, so a private URL never lands in someone
 *    else's logs;
 *  - camera, microphone, location and payment APIs are off for every frame.
 *    WebAuthn (passkeys) is deliberately left on.
 *
 * The Loki feedback widget is the one third party, allowed only when this
 * deployment turns the widget on. Loosening anything here needs a reason
 * written next to the change.
 */
export const LOKI_ORIGIN = "https://loki.orangecat.ch";

export function contentSecurityPolicy(
  nonce: string,
  { dev = false, widget = false }: { dev?: boolean; widget?: boolean } = {},
): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) throw new Error("CSP nonce is malformed");
  const extra = widget ? ` ${LOKI_ORIGIN}` : "";
  return [
    "default-src 'self'",
    // `unsafe-eval` only in development, where React needs it for its stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Next sets a few inline style attributes; styles cannot run code, and
    // blocking them would only break layout.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${extra}${dev ? " ws:" : ""}`,
    widget ? `frame-src ${LOKI_ORIGIN}` : "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Headers for every response, pages and API alike. Read by next.config.ts. */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), interest-cohort=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** A fresh, unguessable nonce per response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
