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
const deps = (overrides: Partial<PreviewDeps> = {}): PreviewDeps => ({
  findProject: async (dir) =>
    dir === DIR ? { name: "Francesco Tarallo", widgetToken: "fcw_abc123" } : null,
  readFile: async (file) => {
    const body = files.get(file);
    return body === undefined ? null : new TextEncoder().encode(body);
  },
  allowAttempt: () => ++attempts <= 3,
  secureCookies: true,
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
    res.status === 503 && (await res.text()).includes("not available"),
    "no code configured: previews say they are off",
  );

  console.log(`\npreviews-route: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
