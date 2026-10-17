// The preview route end to end, on real Request/Response objects with the
// database and the disk replaced by a map: what a stranger, a person with the
// code, and someone guessing file paths each get back.
import path from "path";
import {
  handlePreviewGet,
  handlePreviewPost,
  type PreviewDeps,
} from "../../src/lib/previews/handle";

process.env.LOKI_PREVIEWS_ROOT = "/srv/previews";
process.env.AUTH_SECRET = "test-secret-for-previews-0123456789";
process.env.LOKI_PREVIEW_CODE = "aaaaaa11";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "✓" : "✗"} ${name}`);
};

const DIR = "/srv/previews/francesco-tarallo";
const files = new Map<string, string>([
  [path.join(DIR, "index.html"), "<html><body><h1>Francesco</h1></body></html>"],
  [path.join(DIR, "img/portrait.jpg"), "JPEGBYTES"],
  [path.join(DIR, ".git/config"), "[core]"],
]);
let attempts = 0;
const written = new Map<string, Uint8Array>();
const taken: { url: string; cookie: boolean; header: boolean }[] = [];
const deps = (overrides: Partial<PreviewDeps> = {}): PreviewDeps => ({
  findProject: async (dir) =>
    dir === DIR ? { name: "Francesco Tarallo", widgetToken: "fcw_abc123" } : null,
  readFile: async (file) => {
    const body = files.get(file);
    if (body !== undefined) return new TextEncoder().encode(body);
    return written.get(file) ?? null;
  },
  writeFile: async (file, bytes) => {
    written.set(file, bytes);
  },
  takePicture: async (url, opts) => {
    taken.push({
      url,
      cookie: Boolean(opts.cookies?.length),
      header: opts.headers?.["x-loki-picture"] === "1",
    });
    return { ok: true, mimeType: "image/jpeg", base64: Buffer.from("JPEG!").toString("base64") };
  },
  allowAttempt: () => ++attempts <= 3,
  secureCookies: true,
  appOrigin: "https://loki.example",
  ...overrides,
});

const BASE = "https://loki.example/p/francesco-tarallo";
const get = (p: string, init: RequestInit = {}) => new Request(`${BASE}${p}`, init);
const seg = (p: string) => p.split("/").filter(Boolean);

async function main() {
  // ---- a stranger ----
  let res = await handlePreviewGet(get(""), "francesco-tarallo", [], deps());
  ok(res.status === 307, "the bare address redirects…");
  ok(
    res.headers.get("location") === `${BASE}/index.html`,
    "…to index.html, so the site's relative links resolve",
  );

  res = await handlePreviewGet(get("/index.html"), "francesco-tarallo", seg("index.html"), deps());
  let body = await res.text();
  ok(res.status === 401 && body.includes("Access code"), "without the code: the gate");
  ok(!body.includes("<h1>Francesco</h1>"), "…and none of the page");
  ok(!body.includes("Francesco"), "…and not whose site it is (client work stays private)");
  ok(res.headers.get("x-robots-tag") === "noindex, nofollow", "…and not indexed");

  res = await handlePreviewGet(
    get("/img/portrait.jpg"),
    "francesco-tarallo",
    seg("img/portrait.jpg"),
    deps(),
  );
  ok(
    res.status === 401 && (await res.text()) === "",
    "without the code: a photo is refused, empty",
  );

  res = await handlePreviewGet(get("/index.html"), "nobody-here", seg("index.html"), deps());
  ok(res.status === 404, "an unknown preview is a 404, not a gate (no probing for names)");
  res = await handlePreviewGet(get("/index.html"), "../etc", seg("index.html"), deps());
  ok(res.status === 404, "a bad slug is a 404");

  // ---- entering the code ----
  const post = (code: string, json = true) =>
    new Request(BASE, {
      method: "POST",
      headers: json
        ? { "content-type": "application/json" }
        : { "content-type": "application/x-www-form-urlencoded" },
      body: json ? JSON.stringify({ code }) : new URLSearchParams({ code }).toString(),
    });
  res = await handlePreviewPost(post("wrong"), "francesco-tarallo", "1.2.3.4", deps());
  ok(res.status === 401 && !res.headers.get("set-cookie"), "a wrong code: refused, no cookie");
  ok(
    ((await res.json()) as { error?: string }).error?.includes("does not open") ?? false,
    "…with a reason",
  );

  res = await handlePreviewPost(post("AAAA-AA11"), "francesco-tarallo", "1.2.3.4", deps());
  const setCookie = res.headers.get("set-cookie") ?? "";
  ok(res.status === 200, "the right code (any case, with a dash): accepted");
  ok(/^loki_preview=\d+\.[\w-]+;/.test(setCookie), "…sets the access cookie");
  ok(
    /Path=\/p/.test(setCookie) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie),
    "…scoped to /p, HttpOnly, Secure",
  );
  const cookie = setCookie.split(";")[0];

  res = await handlePreviewPost(
    post("aaaaaa11", false),
    "francesco-tarallo",
    "1.2.3.4",
    deps({ allowAttempt: () => true }),
  );
  ok(
    res.status === 303 && res.headers.get("location") === `${BASE}/index.html`,
    "a plain form post redirects to the page",
  );

  res = await handlePreviewPost(
    post("aaaaaa11"),
    "francesco-tarallo",
    "1.2.3.4",
    deps({ allowAttempt: () => false }),
  );
  ok(res.status === 429, "too many tries: a pause, even with the right code");

  // ---- with the code ----
  const withCookie = { headers: { cookie: `other=1; ${cookie}` } };
  res = await handlePreviewGet(
    get("/index.html", withCookie),
    "francesco-tarallo",
    seg("index.html"),
    deps(),
  );
  body = await res.text();
  ok(res.status === 200 && body.includes("<h1>Francesco</h1>"), "with the code: the page");
  ok(body.includes('data-fc-project="fcw_abc123"'), "…with Loki's widget on it");
  ok(res.headers.get("cache-control") === "no-store", "…never cached by a shared cache");

  res = await handlePreviewGet(
    get("/img/portrait.jpg", withCookie),
    "francesco-tarallo",
    seg("img/portrait.jpg"),
    deps(),
  );
  ok(
    res.status === 200 && res.headers.get("content-type") === "image/jpeg",
    "with the code: the photo",
  );

  res = await handlePreviewGet(
    get("/.git/config", withCookie),
    "francesco-tarallo",
    [".git", "config"],
    deps(),
  );
  ok(res.status === 404, "the folder's git history is never served");
  res = await handlePreviewGet(
    get("/x", withCookie),
    "francesco-tarallo",
    ["..", "other", "index.html"],
    deps(),
  );
  ok(res.status === 404, "nothing outside the folder is served");
  res = await handlePreviewGet(
    get("/nope.html", withCookie),
    "francesco-tarallo",
    seg("nope.html"),
    deps(),
  );
  ok(res.status === 404, "a missing page is a 404");

  res = await handlePreviewGet(
    get("/index.html", withCookie),
    "francesco-tarallo",
    seg("index.html"),
    deps({ findProject: async () => ({ name: "Francesco Tarallo", widgetToken: null }) }),
  );
  ok(
    !(await res.text()).includes("data-fc-project"),
    "no widget key: the page is served without one",
  );

  // ---- Loki's own pages inside the preview: the before-and-after tour ----
  files.set(
    path.join(DIR, ".loki/source.json"),
    JSON.stringify({
      website: "https://francesco.example/",
      pages: ["https://francesco.example/", "https://francesco.example/music"],
      createdAt: "2026-10-17T00:00:00.000Z",
    }),
  );
  files.set(path.join(DIR, "music/index.html"), "<html><body><h1>Music</h1></body></html>");
  res = await handlePreviewGet(
    get("/_loki/before-after"),
    "francesco-tarallo",
    seg("_loki/before-after"),
    deps(),
  );
  ok(res.status === 401, "the tour is behind the code too");
  res = await handlePreviewGet(
    get("/_loki/picture?side=before&i=0", { headers: { accept: "image/*" } }),
    "francesco-tarallo",
    seg("_loki/picture"),
    deps(),
  );
  ok(res.status === 401 && (await res.text()) === "", "…and so is every picture, empty");

  res = await handlePreviewGet(
    get("/_loki/before-after", withCookie),
    "francesco-tarallo",
    seg("_loki/before-after"),
    deps(),
  );
  body = await res.text();
  ok(res.status === 200 && body.includes("Before and after"), "with the code: the tour");
  ok(
    body.includes("_loki/picture?side=before&amp;i=0") &&
      body.includes("_loki/picture?side=after&amp;i=1"),
    "…one row per live page the consultation read, when the build left no list",
  );
  ok(body.includes('href="../music/index.html"'), "…linking the new page at the live path");
  ok(body.includes("https://francesco.example/music"), "…and the live page");
  ok(body.includes('data-fc-project="fcw_abc123"'), "…with Loki's widget, so notes can be left");

  files.set(
    path.join(DIR, "improvements.json"),
    JSON.stringify({
      headline: "The music page plays.",
      changes: [{ title: "Music", livePath: "/music", newPath: "music/index.html" }],
      walkthrough: { problem: "Nothing played.", change: "A player." },
    }),
  );
  res = await handlePreviewGet(
    get("/_loki/before-after", withCookie),
    "francesco-tarallo",
    seg("_loki/before-after"),
    deps(),
  );
  body = await res.text();
  ok(
    body.includes("The music page plays.") && !body.includes("i=1"),
    "the build's own list replaces the inferred rows",
  );
  ok(body.includes("Nothing played."), "…and its account is on the page");

  taken.length = 0;
  res = await handlePreviewGet(
    get("/_loki/picture?side=before&i=0", withCookie),
    "francesco-tarallo",
    seg("_loki/picture"),
    deps(),
  );
  ok(
    res.status === 200 && res.headers.get("content-type") === "image/jpeg",
    "a before picture: the live page, photographed",
  );
  ok(
    taken[0]?.url === "https://francesco.example/music" && !taken[0].cookie,
    "…by its address, with no cookie",
  );
  res = await handlePreviewGet(
    get("/_loki/picture?side=after&i=0", withCookie),
    "francesco-tarallo",
    seg("_loki/picture"),
    deps(),
  );
  ok(
    taken[1]?.url === "https://loki.example/p/francesco-tarallo/music/index.html" &&
      taken[1].cookie &&
      taken[1].header,
    "an after picture: the new page served by Loki, with the access cookie and the picture header",
  );
  ok(
    [...written.keys()].every((f) => f.startsWith(path.join(DIR, ".loki/pictures/"))),
    "…kept under .loki/pictures, which the route never serves",
  );
  const count = taken.length;
  await handlePreviewGet(
    get("/_loki/picture?side=after&i=0", withCookie),
    "francesco-tarallo",
    seg("_loki/picture"),
    deps(),
  );
  ok(taken.length === count, "the second ask is served from the kept picture");
  res = await handlePreviewGet(
    get("/_loki/picture?side=after&i=7", withCookie),
    "francesco-tarallo",
    seg("_loki/picture"),
    deps(),
  );
  ok(res.status === 404, "a row that does not exist is a 404");
  res = await handlePreviewGet(
    get("/_loki/picture?side=before&i=0", withCookie),
    "francesco-tarallo",
    seg("_loki/picture"),
    deps({
      takePicture: async () => ({ ok: false, reason: "no-browser" }),
      readFile: async () => null,
    }),
  );
  ok(res.status === 404, "no browser: no picture, and the page shows the link instead");
  res = await handlePreviewGet(
    get("/index.html", { headers: { cookie: cookie, "x-loki-picture": "1" } }),
    "francesco-tarallo",
    seg("index.html"),
    deps(),
  );
  ok(
    !(await res.text()).includes("data-fc-project"),
    "a page served for a picture carries no widget",
  );
  res = await handlePreviewGet(
    get("/_loki/other", withCookie),
    "francesco-tarallo",
    seg("_loki/other"),
    deps(),
  );
  ok(res.status === 404, "nothing else lives under _loki");
  files.delete(path.join(DIR, "improvements.json"));

  // ---- on its own address (<label>.orangecat.ch, the preview IS the root) ----
  const ROOT = "https://francesco.orangecat.ch/p/francesco-tarallo";
  const rooted = (p: string, init: RequestInit = {}) =>
    new Request(`${ROOT}${p}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "x-preview-root": "1" },
    });
  res = await handlePreviewGet(
    rooted("/index.html"),
    "francesco-tarallo",
    seg("index.html"),
    deps(),
  );
  body = await res.text();
  ok(
    res.status === 401 && body.includes('action="/"'),
    "own address: the gate posts to /, not /p/…",
  );
  res = await handlePreviewPost(
    rooted("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "aaaaaa11" }),
    }),
    "francesco-tarallo",
    "203.0.113.9",
    deps({ allowAttempt: () => true }),
  );
  const rootedCookie = res.headers.get("set-cookie") ?? "";
  ok(/;\s*Path=\/(;|$)/.test(rootedCookie), "own address: the cookie reaches every path");
  res = await handlePreviewPost(
    rooted("", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "code=aaaaaa11",
    }),
    "francesco-tarallo",
    "203.0.113.9",
    deps({ allowAttempt: () => true }),
  );
  ok(
    res.status === 303 && res.headers.get("location") === "https://francesco.orangecat.ch/",
    "own address: after the code, back to /",
  );
  res = await handlePreviewGet(
    rooted("/index.html", { headers: { cookie: rootedCookie.split(";")[0] } }),
    "francesco-tarallo",
    seg("index.html"),
    deps(),
  );
  body = await res.text();
  ok(
    res.status === 200 && body.includes('src="https://loki.example/widget.js"'),
    "own address: the widget loads from Loki, not from the preview's own host",
  );
  res = await handlePreviewPost(
    post("aaaaaa11"),
    "francesco-tarallo",
    "203.0.113.9",
    deps({ allowAttempt: () => true }),
  );
  ok(
    /;\s*Path=\/p(;|$)/.test(res.headers.get("set-cookie") ?? ""),
    "under /p/…: the cookie stays scoped to /p",
  );

  // ---- the owner's own code (set in the app) beats the server's ----
  const ownDeps = (over: Partial<PreviewDeps> = {}) =>
    deps({
      findProject: async (dir) =>
        dir === DIR ? { name: "Francesco Tarallo", widgetToken: "fcw_abc123", code: "Cat" } : null,
      allowAttempt: () => true,
      ...over,
    });
  res = await handlePreviewPost(post("cat"), "francesco-tarallo", "198.51.100.1", ownDeps());
  const ownCookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  ok(res.status === 200 && ownCookie.startsWith("loki_preview="), "the owner's code opens it");
  res = await handlePreviewPost(post("aaaaaa11"), "francesco-tarallo", "198.51.100.1", ownDeps());
  ok(res.status === 401, "…and the server's code no longer does");
  res = await handlePreviewGet(
    get("/index.html", { headers: { cookie: ownCookie } }),
    "francesco-tarallo",
    seg("index.html"),
    ownDeps(),
  );
  ok(res.status === 200, "a visitor who entered it gets the page");
  const envWas = process.env.LOKI_PREVIEW_CODE;
  delete process.env.LOKI_PREVIEW_CODE;
  res = await handlePreviewGet(
    get("/index.html", { headers: { cookie: ownCookie } }),
    "francesco-tarallo",
    seg("index.html"),
    ownDeps(),
  );
  ok(res.status === 200, "with no server code at all, the owner's code is enough");
  process.env.LOKI_PREVIEW_CODE = envWas;

  // ---- the code changes ----
  process.env.LOKI_PREVIEW_CODE = "newcode22";
  res = await handlePreviewGet(
    get("/index.html", withCookie),
    "francesco-tarallo",
    seg("index.html"),
    deps(),
  );
  ok(res.status === 401, "after the code changes, the old cookie opens nothing");

  // ---- switched off ----
  delete process.env.LOKI_PREVIEW_CODE;
  res = await handlePreviewGet(
    get("/index.html", withCookie),
    "francesco-tarallo",
    seg("index.html"),
    deps(),
  );
  ok(
    res.status === 503 && (await res.text()).includes("not open yet"),
    "no code configured: previews say they are off",
  );

  console.log(`\npreviews-route: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
