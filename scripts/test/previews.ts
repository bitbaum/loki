// Prospect previews (docs/architecture/prospect-previews.md): the rules that
// keep a private draft private and the widget on every page of it.
//
// Pure — no database, no server. The route composes exactly these pieces.
import path from "path";
import { isPreviewAddress, previewHostFor, previewHostUrl } from "../../src/lib/previews/address";
import { PREVIEW_BUILD_RULES, previewBuildPrompt } from "../../src/config/preview-brief";
import { PREVIEWS, previewEntryPath } from "../../src/config/previews";
import { projectChannelLock } from "../../src/lib/execution-access";
import {
  configuredPreviewCode,
  createPreviewAccessCookie,
  previewCodeMatches,
  verifyPreviewAccessCookie,
} from "../../src/lib/previews/access";
import { previewGatePage } from "../../src/lib/previews/gate-page";
import {
  isPreviewDir,
  isPreviewSlug,
  previewDirFor,
  previewsRoot,
  slugifyPreviewName,
} from "../../src/lib/previews/root";
import {
  injectPreviewWidget,
  isHtmlFile,
  previewContentType,
  resolvePreviewFile,
} from "../../src/lib/previews/serve";

// Every function under test reads the environment when called, not when
// imported, so setting it here (after the hoisted imports) is in time.
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

// ---- where previews live ----
ok(previewsRoot() === "/srv/previews", "the root comes from LOKI_PREVIEWS_ROOT");
ok(slugifyPreviewName("Francesco Tarallo") === "francesco-tarallo", "a name becomes a folder");
ok(slugifyPreviewName("Café Zürich & Söhne") === "cafe-zurich-sohne", "accents fold to ASCII");
ok(slugifyPreviewName("Straße 7") === "strasse-7", "ß becomes ss");
ok(slugifyPreviewName("!!!") === "preview", "a name with no letters still gets a folder");
ok(
  slugifyPreviewName("x".repeat(200)).length <= PREVIEWS.maxSlugLength,
  "a long name is cut to the slug limit",
);
ok(isPreviewSlug("francesco-tarallo"), "a slug is accepted");
for (const bad of ["", "-a", "a-", "A", "a/b", "..", ".git", "a b"]) {
  ok(!isPreviewSlug(bad), `"${bad}" is not a slug`);
}
ok(
  previewDirFor("francesco-tarallo") === "/srv/previews/francesco-tarallo",
  "a slug maps to its folder",
);
ok(previewDirFor("../etc") === null, "a bad slug maps to nothing");
ok(isPreviewDir("/srv/previews/francesco-tarallo"), "a preview folder is recognised");
ok(!isPreviewDir("/srv/previews"), "the root itself is not a preview");
ok(!isPreviewDir("/srv/previews/a/b"), "a subfolder of a preview is not a preview");
ok(!isPreviewDir("/srv/other/x"), "a folder elsewhere is not a preview");

// ---- previews build on the box, never on a laptop ----
ok(
  projectChannelLock({ dirPath: "/srv/previews/francesco-tarallo", gitUrl: null }) === "cloud",
  "a preview folder with no repository is locked to the cloud builder",
);
ok(
  projectChannelLock({ dirPath: "/home/me/code/thing", gitUrl: null }) === "local",
  "an ordinary folder with no repository is still locked to the laptop",
);

// ---- which file a URL may name ----
const DIR = "/srv/previews/francesco-tarallo";
ok(resolvePreviewFile(DIR, []) === path.join(DIR, "index.html"), "no path opens index.html");
ok(resolvePreviewFile(DIR, ["img", "a.jpg"]) === path.join(DIR, "img/a.jpg"), "a nested file");
for (const bad of [
  [".git", "config"],
  ["img", ".env"],
  [".."],
  ["..", "other", "index.html"],
  ["a\\b"],
  ["a\0b"],
  [""],
  ["img", ""],
]) {
  ok(resolvePreviewFile(DIR, bad) === null, `refused: ${JSON.stringify(bad)}`);
}
ok(previewContentType("x/a.MP3") === "audio/mpeg", "types by extension, any case");
ok(previewContentType("x/a.php") === null, "an unknown type is not served");
ok(isHtmlFile("index.html") && !isHtmlFile("a.css"), "HTML is recognised");
ok(
  previewEntryPath("francesco-tarallo") === "/p/francesco-tarallo/index.html",
  "the entry address",
);

// ---- the widget goes on every page, once ----
const page = "<html><body><h1>Hi</h1></body></html>";
const withWidget = injectPreviewWidget(page, "fcw_abc123");
ok(
  withWidget.includes(
    '<script src="/widget.js" data-fc-project="fcw_abc123" async></script>\n</body>',
  ),
  "the widget tag lands before </body>",
);
ok(
  injectPreviewWidget(withWidget, "fcw_other") === withWidget,
  "a page with a widget gets no second one",
);
ok(
  injectPreviewWidget("<p>no body tag", "fcw_x").endsWith("async></script>\n"),
  "a page without </body> still gets it",
);
ok(
  injectPreviewWidget(page, 'fcw_x" onload="alert(1)').includes(
    'data-fc-project="fcw_xonloadalert1"',
  ),
  "a token cannot break out of its attribute",
);
ok(
  injectPreviewWidget("<BODY>x</BODY>", "fcw_x").includes("</script>\n</BODY>"),
  "</BODY> in capitals is found too",
);

// ---- the access code ----
ok(configuredPreviewCode() === "aaaaaa11", "the code comes from LOKI_PREVIEW_CODE");
ok(previewCodeMatches("aaaaaa11"), "the right code opens");
ok(previewCodeMatches(" AAAA-AA11 "), "case, spaces and dashes do not matter");
ok(!previewCodeMatches("aaaaaa12"), "a wrong code does not open");
ok(!previewCodeMatches(""), "an empty code does not open");
ok(!previewCodeMatches("aaaaaa11", null), "with no code configured nothing opens");

const now = 1_800_000_000_000;
const cookie = createPreviewAccessCookie(now);
ok(!!cookie && verifyPreviewAccessCookie(cookie ?? "", now + 1000), "a fresh cookie opens");
ok(
  !verifyPreviewAccessCookie(cookie ?? "", now + PREVIEWS.cookieTtlMs + 1),
  "an expired cookie does not",
);
ok(
  !verifyPreviewAccessCookie(cookie ?? "", now + 1000, "newcode99"),
  "changing the code closes every earlier cookie",
);
ok(!verifyPreviewAccessCookie(`${now + 99_999}.forged`, now), "a forged cookie does not open");
ok(!verifyPreviewAccessCookie(`${cookie}.extra`, now), "a cookie with extra parts does not open");
ok(!verifyPreviewAccessCookie(undefined, now), "no cookie does not open");
ok(createPreviewAccessCookie(now, null) === null, "no code, no cookie");

// ---- the gate page ----
const gate = previewGatePage({ name: '<img src=x onerror="x">', postUrl: "/p/x" });
ok(!gate.includes("<img src=x"), "a project name cannot inject markup into the gate");
ok(gate.includes('name="robots" content="noindex, nofollow"'), "the gate is not indexed");
ok(
  gate.includes("location.reload()"),
  "the gate reloads in place, keeping an owner link's fragment",
);

// ---- the build brief ----
const brief = previewBuildPrompt({
  name: "Francesco Tarallo",
  about: "Zurich DJ",
  previewUrl: "https://loki.orangecat.ch/p/francesco-tarallo/index.html",
});
ok(
  brief.includes("Francesco Tarallo") && brief.includes("Zurich DJ"),
  "the brief names who and what",
);
ok(
  PREVIEW_BUILD_RULES.every((rule) => brief.includes(rule)),
  "every standing rule reaches the agent",
);
ok(/do not push/i.test(brief), "the brief keeps the folder off GitHub");
ok(!/\n\n\n/.test(brief), "no runs of blank lines");

// ---- a preview's own address ----
ok(isPreviewAddress("francesco") && isPreviewAddress("murphys-bar"), "a name makes an address");
ok(
  !isPreviewAddress("loki") && !isPreviewAddress("www") && !isPreviewAddress("p"),
  "reserved names are not addresses",
);
ok(
  !isPreviewAddress("Murphy's") && !isPreviewAddress("-x") && !isPreviewAddress(""),
  "malformed labels are not addresses",
);
ok(previewHostFor("francesco") === "francesco.orangecat.ch", "the host is <label>.orangecat.ch");
ok(
  previewHostUrl("francesco") === "https://francesco.orangecat.ch/",
  "…and its address opens at the root",
);

console.log(`\npreviews: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
