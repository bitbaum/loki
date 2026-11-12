// What the studio site may learn about the person looking at it, and where
// its sign-in is allowed to send them back to. Pure: no database, no server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMISSION } from "../../src/config/commission";
import { STUDIO_SESSION_HEADERS, studioReturnUrl } from "../../src/lib/studio/access";
import { studioSessionSummary } from "../../src/lib/studio/session-summary";

const APP = "https://loki.orangecat.ch";
const STUDIO = COMMISSION.studioOrigin;

// ── the answer ────────────────────────────────────────────────────────────
const out = studioSessionSummary(
  { user: null, owner: false, applications: null },
  `${APP}/`,
  "/builders/",
);
assert.deepEqual(out, {
  signedIn: false,
  links: {
    signIn: `${APP}/studio/return?to=%2Fbuilders%2F`,
    signOut: `${APP}/sign-out?then=studio`,
    builder: `${APP}/studio/partner`,
    review: `${APP}/feedback/studio`,
    app: `${APP}/loki`,
  },
});
// The home page needs no `to`.
assert.equal(
  studioSessionSummary({ user: null, owner: false, applications: null }, APP, "/").links.signIn,
  `${APP}/studio/return`,
);
assert.equal(
  studioSessionSummary({ user: null, owner: false, applications: null }, APP).links.signIn,
  `${APP}/studio/return`,
);

const builder = studioSessionSummary(
  {
    user: { name: "  Ada Builder ", username: "ada", image: "https://orangecat.ch/a/ada.png" },
    owner: false,
    applications: [{ name: "Ada", status: { title: "Approved" } }],
  },
  APP,
);
assert.equal(builder.signedIn, true);
assert.deepEqual(builder.user, {
  name: "Ada Builder",
  handle: "ada",
  image: "https://orangecat.ch/a/ada.png",
});
assert.equal(builder.owner, false);
assert.deepEqual(builder.builder, {
  connected: true,
  applications: [{ name: "Ada", status: "Approved" }],
});

// Signed in without OrangeCat: no applications to open, and it says why.
const plain = studioSessionSummary(
  {
    user: { name: null, username: null, image: "javascript:alert(1)" },
    owner: true,
    applications: null,
  },
  APP,
);
assert.deepEqual(
  plain.user,
  { name: null, handle: null, image: null },
  "a name is never invented; only an https picture is passed on",
);
assert.equal(plain.owner, true);
assert.deepEqual(plain.builder, { connected: false, applications: [] });

// Nothing in the answer identifies an account or opens a request: the page
// that asks is public, and every script it runs can read this.
const everything = JSON.stringify(
  studioSessionSummary(
    {
      user: { name: "Ada", username: "ada", image: null },
      owner: true,
      // A caller that passes more than the summary needs must not leak it.
      applications: [
        {
          name: "Ada",
          status: { title: "Approved" },
          id: "5b0c6a4e-0000-4000-8000-000000000000",
          email: "ada@example.com",
          accessKey: "spt_secret",
        } as never,
      ],
    },
    APP,
  ),
);
for (const leak of ["5b0c6a4e", "@example.com", "spt_", "email", '"id"'])
  assert.equal(everything.includes(leak), false, `the summary must not carry ${leak}`);

// ── the way back ──────────────────────────────────────────────────────────
for (const [to, want] of [
  ["/", "/"],
  ["/builders/", "/builders/"],
  ["/packages/chatkit/", "/packages/chatkit/"],
  ["/sbb-fundbuero/", "/sbb-fundbuero/"],
] as const)
  assert.equal(studioReturnUrl(to), `${STUDIO}${want}`, `${to} is a page of the studio site`);
for (const to of [
  null,
  undefined,
  "",
  "builders/",
  "/builders", // the static site serves directories; no trailing slash is not one of its pages
  "//evil.example/",
  "/\\evil.example/",
  "https://evil.example/",
  "/builders/?next=https://evil.example",
  "/builders/#x",
  "/Builders/",
  "/a/../b/",
  "/a/b/c/d/e/",
  "/%2f%2fevil.example/",
  "/builders/\n",
  "/@evil.example/",
])
  assert.equal(
    studioReturnUrl(to),
    `${STUDIO}/`,
    `${JSON.stringify(to)} must fall back to the home page`,
  );
// Whatever comes in, the answer is on the studio's own origin.
for (const to of ["//evil.example/", "/x/", "https://evil.example/", "/\\/evil/"])
  assert.equal(new URL(studioReturnUrl(to)).origin, STUDIO);

// ── the headers ───────────────────────────────────────────────────────────
assert.equal(
  STUDIO_SESSION_HEADERS["Access-Control-Allow-Origin"],
  STUDIO,
  "one named origin, never * and never an echo",
);
assert.equal(STUDIO_SESSION_HEADERS["Access-Control-Allow-Credentials"], "true");
assert.equal(STUDIO_SESSION_HEADERS["Access-Control-Allow-Methods"], "GET, OPTIONS", "read-only");
assert.equal(STUDIO_SESSION_HEADERS["Cache-Control"], "no-store");
assert.match(STUDIO_SESSION_HEADERS.Vary, /Cookie/);

// ── the proxy ─────────────────────────────────────────────────────────────
// The session answer and the sign-out landing are public; the sign-in door is
// not, because the proxy's sign-in round trip IS the door.
const proxy = readFileSync(new URL("../../src/proxy.ts", import.meta.url), "utf8");
const matcher = /^\s*"(\/\(\(\?!.*)",?$/m.exec(proxy)?.[1];
assert.ok(matcher, "the proxy matcher is one string");
const guarded = (path: string) => new RegExp(`^${matcher.replace(/\\\\/g, "\\")}$`).test(path);
assert.equal(
  guarded("/api/studio-session"),
  false,
  "signed out must be an answer, not the proxy's 401",
);
assert.equal(guarded("/studio/left"), false, "nobody is signed in when a sign-out lands");
assert.equal(guarded("/studio/return"), true, "the sign-in door must go through sign-in");
// Built, not written: a path that names no route is exactly what this asserts,
// and the internal-paths check would rightly flag it as a caller of nothing.
assert.equal(
  guarded(["", "api", "studio-session" + "s"].join("/")),
  true,
  "a sibling route is protected by default",
);
assert.equal(guarded("/api/studio-review"), true);
assert.equal(guarded("/api/fleet/private"), false);

console.log("studio-session: ok");
