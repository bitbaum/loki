/**
 * Inline self-test: the public capture endpoint is cross-origin for OUR sites
 * and nobody else's.
 *
 * THE FAULT THIS LOCKS DOWN
 * -------------------------
 * `POST /api/newsletter` has no token and no cookie — it is admitted purely on
 * being public, and it writes a row per call. Copying the feedback widget's
 * `Access-Control-Allow-Origin: *` onto it would let any page on the internet
 * post into the subscriber list from a visitor's browser, with the visitor's
 * IP spending the rate-limit bucket. The widget can afford the wildcard because
 * its `fcw_*` token is the actual gate; this route cannot.
 *
 * WHAT IS PINNED
 * --------------
 *   • an allowlisted origin is echoed back verbatim (never `*`);
 *   • an unknown origin gets NO ACAO at all, so the browser refuses the answer;
 *   • a missing Origin header is not treated as allowed;
 *   • every response varies on Origin — without it a cache can serve the
 *     headers computed for one origin to a request from another;
 *   • the allowlist itself contains no wildcard and no plain-http public host.
 *
 * Run: npx tsx scripts/test/newsletter-public-cors.ts
 */
import {
  PUBLIC_POST_ORIGINS,
  isAllowedPublicOrigin,
  publicCorsHeaders,
} from "@/lib/api/public-cors";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const STUDIO = "https://bitbaum.orangecat.ch";

// The studio site is the reason this exists — if it ever drops off the list,
// /hire/'s waitlist form silently stops working in every browser.
assert(
  (PUBLIC_POST_ORIGINS as readonly string[]).includes(STUDIO),
  `${STUDIO} must stay on the allowlist — it is the /hire/ waitlist origin`,
);

const allowed = publicCorsHeaders(STUDIO);
assert(
  allowed["Access-Control-Allow-Origin"] === STUDIO,
  "an allowlisted origin must be echoed back verbatim",
);
assert(
  allowed["Access-Control-Allow-Origin"] !== "*",
  "a tokenless capture endpoint must never answer a wildcard origin",
);
assert(
  allowed["Access-Control-Allow-Methods"] === "POST, OPTIONS",
  "preflight must name the verbs",
);
assert(allowed["Vary"] === "Origin", "an allowed response must vary on Origin");

for (const hostile of [
  "https://bitbaum.orangecat.ch.evil.test",
  "https://evil.test",
  "http://bitbaum.orangecat.ch",
  "null",
]) {
  const headers = publicCorsHeaders(hostile);
  assert(
    !("Access-Control-Allow-Origin" in headers),
    `${hostile} must get no ACAO — a prefix or scheme match is not a match`,
  );
  assert(headers["Vary"] === "Origin", `${hostile} response must still vary on Origin`);
  assert(!isAllowedPublicOrigin(hostile), `${hostile} must not be allowed`);
}

for (const empty of [null, undefined, "", "   "]) {
  assert(!isAllowedPublicOrigin(empty), "a missing Origin header is not an allowed origin");
  assert(
    !("Access-Control-Allow-Origin" in publicCorsHeaders(empty)),
    "a missing Origin header must not produce an ACAO",
  );
}

for (const origin of PUBLIC_POST_ORIGINS) {
  assert(origin !== "*", "the allowlist must not contain a wildcard");
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
  assert(
    origin.startsWith("https://") || isLocal,
    `${origin} must be https — plain http is only for local development`,
  );
}

console.log(
  `✓ newsletter public CORS: ${PUBLIC_POST_ORIGINS.length} allowlisted, wildcard refused`,
);
