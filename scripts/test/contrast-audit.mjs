/**
 * Contrast audit — finds ACTIONS the user cannot see.
 *
 * Run: npm run audit:contrast
 *      BASE=https://loki.orangecat.ch npm run audit:contrast
 *
 * Session: LOKI_SESSION_TOKEN, or AUDIT_DATABASE_URL + AUTH_SECRET
 * (same contract as responsive-audit.mjs — see mintToken there).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * On /control the only route to a feedback report's screenshot, history and
 * widget setup was a link rendered at 3.13:1 — below the 4.5:1 WCAG AA floor
 * for small text, and less than half the contrast of the label directly above
 * it. The operator's report was not "low contrast", it was "i dont see it".
 * That is the failure mode worth automating: an affordance that renders, passes
 * every type check, is present in the DOM and in the accessibility tree — and
 * is invisible. No unit test can catch it, because nothing is wrong until it is
 * painted.
 *
 * Scope is deliberately INTERACTIVE text only (links, buttons, summaries).
 * Auditing every text node would bury the signal: the --text-tertiary token is
 * itself below AA on the dark surface and has ~429 usages, so a full-page sweep
 * reports a wall of body copy and nobody reads the output twice. An action you
 * cannot find is a feature that does not exist; a dim caption is a preference.
 * If the token is ever raised, widen this to all text and delete this comment.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const BASE = (process.env.BASE ?? "https://loki.orangecat.ch").replace(/\/$/, "");
const ROUTES = (
  process.env.ROUTES ?? "/control,/today,/projects,/activity,/prompts,/settings"
).split(",");
/**
 * Both themes, because only one of them was ever measured.
 *
 * A fresh browser context has no `loki-theme` in localStorage, so ThemeProvider
 * falls back to its `defaultTheme="dark"` — which means this audit, and the
 * responsive one beside it, have always reported on the dark theme alone.
 * CLAUDE.md is explicit that "light mode is a real state your styling must
 * survive", and nothing checked it.
 *
 * It matters: measured on prod 2026-09-20, the same page that has ONE sub-AA
 * text node in dark has FORTY-EIGHT in light, because the light ramp's muted
 * tier lands at 2.28:1 on the page surface. None of that was visible to a gate
 * that only ever rendered dark.
 */
const THEMES = (process.env.THEMES ?? "dark,light").split(",").map((t) => t.trim());
/** WCAG 2.1 AA: 4.5:1 for text under 18.66px (or under 24px when not bold). */
const AA_SMALL = 4.5;
const AA_LARGE = 3.0;

function readLocalEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, "");
  }
}
readLocalEnv();

function cookieName() {
  return BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
}

async function mintToken() {
  const fromEnv = process.env.LOKI_SESSION_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const dbUrl = process.env.AUDIT_DATABASE_URL?.trim();
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return null;
  let claims = null;
  if (dbUrl) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl, { max: 1, ssl: false });
    try {
      const rows = await sql`
        SELECT id, email, name, username, onboarded_at FROM users
        WHERE is_default = true OR email IS NOT NULL
        ORDER BY is_default DESC, created_at ASC LIMIT 1`;
      const u = rows[0];
      if (u?.id) {
        claims = {
          id: u.id,
          sub: u.id,
          email: u.email,
          name: u.name,
          username: u.username,
          onboardedAt: u.onboarded_at,
          onboardingComplete: Boolean(u.username && u.onboarded_at),
        };
      }
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }
  if (!claims) return null;
  const { encode } = await import("@auth/core/jwt");
  return encode({ token: claims, secret, salt: cookieName() });
}

/**
 * Runs in the page. Passed as a STRING on purpose — a bundler that injects a
 * `__name` helper into arrow functions makes page.evaluate throw
 * "ReferenceError: __name is not defined" inside the browser context.
 */
const MEASURE = `(() => {
  // Resolve ANY CSS colour syntax (oklch, lab, color-mix, var) to numeric
  // straight RGBA. Painting once is not enough: a translucent colour composites
  // against whatever is already there, so paint it twice over known backdrops
  // and solve. white - black = 255*(1-a)  =>  a, then un-premultiply.
  // This matters — the chips are oklch(1 0 0 / 0.04), a 4%-white overlay on a
  // near-black card. A single paint reports them as SOLID WHITE and the audit
  // then invents failures on perfectly readable text.
  var resolve = function (color) {
    var c = document.createElement("canvas"); c.width = c.height = 1;
    var x = c.getContext("2d", { willReadFrequently: true });
    var paint = function (backdrop) {
      x.globalCompositeOperation = "copy";
      x.fillStyle = backdrop; x.fillRect(0, 0, 1, 1);
      x.globalCompositeOperation = "source-over";
      x.fillStyle = color; x.fillRect(0, 0, 1, 1);
      return Array.prototype.slice.call(x.getImageData(0, 0, 1, 1).data, 0, 3);
    };
    var onBlack = paint("#000"), onWhite = paint("#fff");
    var alpha = 1 - (onWhite[0] - onBlack[0]) / 255;
    if (alpha <= 0.0001) return [0, 0, 0, 0];
    return [onBlack[0] / alpha, onBlack[1] / alpha, onBlack[2] / alpha, alpha];
  };
  var over = function (top, bottom) {
    var a = top[3];
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
      1
    ];
  };
  var lum = function (rgb) {
    var f = function (v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  var ratio = function (fgRgba, bgRgb) {
    // Text can itself be translucent; composite it onto its own backdrop first.
    var fg = fgRgba[3] < 1 ? over(fgRgba, bgRgb) : fgRgba;
    var a = lum(fg), b = lum(bgRgb);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  // Composite every translucent layer between the element and the first opaque
  // ancestor — that stack is what the eye actually sees behind the glyphs.
  var bgOf = function (el) {
    var stack = [], n = el;
    while (n) {
      var c = resolve(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) stack.push(c);
      if (c[3] >= 0.999) break;
      n = n.parentElement;
    }
    if (!stack.length) return [0, 0, 0];
    var base = stack[stack.length - 1];
    if (base[3] < 1) base = over(base, [0, 0, 0, 1]);
    for (var i = stack.length - 2; i >= 0; i--) base = over(stack[i], base);
    return [base[0], base[1], base[2]];
  };
  var sel = 'a, button, summary, [role="button"], [role="link"], [role="tab"]';
  var out = [];
  var nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var text = (el.innerText || "").trim();
    if (!text) continue;                       // icon-only control: no text to read
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    var size = parseFloat(cs.fontSize);
    var weight = parseInt(cs.fontWeight, 10) || 400;
    // WCAG "large text": >=24px, or >=18.66px when bold.
    var large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      text: text.slice(0, 60).replace(/\\s+/g, " "),
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute("href") || "",
      fontSize: size,
      large: large,
      contrast: ratio(resolve(cs.color), bgOf(el))
    });
  }
  return out;
})()`;

async function main() {
  const token = await mintToken();
  if (!token) {
    console.error("✗ no session. Set LOKI_SESSION_TOKEN, or AUDIT_DATABASE_URL + AUTH_SECRET.");
    process.exit(2);
  }
  const browser = await chromium.launch();

  const failures = [];
  let measured = 0;
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([
      {
        name: cookieName(),
        value: token,
        domain: new URL(BASE).hostname,
        path: "/",
        httpOnly: true,
        secure: BASE.startsWith("https://"),
      },
    ]);
    // Seed the same key ThemeProvider persists, before any page script runs.
    await ctx.addInitScript(
      `try { localStorage.setItem("loki-theme", ${JSON.stringify(theme)}); } catch (e) {}`,
    );
    console.log(`\n── ${theme} ──`);
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      try {
        // NOT networkidle: these pages hold an open SSE stream and poll, so the
        // network never goes idle and the wait resolves on a timeout — measuring
        // the server-rendered shell before the client-fetched body arrives. The
        // first run of this audit reported 9 controls on a page with ~60, which
        // is the silent-truncation failure: a clean "✓" over most of the page
        // never examined. Settle on a real, growing DOM instead.
        await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
        // Prove the theme took. Without this the light pass would quietly render
        // dark and report it clean — the exact shape of gate this audit exists to
        // stop: present, green, and measuring the wrong thing.
        const applied = await page.evaluate("document.documentElement.getAttribute('data-theme')");
        if (applied !== theme) {
          throw new Error(`theme did not apply: asked for ${theme}, page is ${applied}`);
        }
        let rows = [];
        let stable = 0;
        // Three consecutive identical counts, and never before the fourth read.
        // Two sufficed when one warm context served every route, but each theme
        // now gets its OWN cold context — and a cold /control served 2 labels
        // twice running while it hydrated, then latched and reported 2 of the
        // 54 it has. An audit that measures a skeleton prints a clean tick for
        // a page it never looked at, which is the failure this file exists to
        // prevent.
        for (let attempt = 0; attempt < 16 && (stable < 3 || attempt < 4); attempt++) {
          await page.waitForTimeout(1000);
          const next = await page.evaluate(MEASURE);
          stable = next.length > 0 && next.length === rows.length ? stable + 1 : 0;
          rows = next;
        }
        console.log(`  ${route}: ${rows.length} interactive labels`);
        measured += rows.length;
        for (const r of rows) {
          const floor = r.large ? AA_LARGE : AA_SMALL;
          if (r.contrast < floor) failures.push({ theme, route, floor, ...r });
        }
      } catch (e) {
        console.error(`  ! ${theme} ${route}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
    await ctx.close();
  }
  await browser.close();

  console.log(
    `\ncontrast audit — ${measured} interactive labels across ${ROUTES.length} routes ` +
      `× ${THEMES.length} theme(s): ${THEMES.join(", ")}\n`,
  );
  if (failures.length === 0) {
    console.log("✓ every interactive label meets its WCAG AA floor");
    process.exit(0);
  }
  // Worst first: the least visible action is the one most worth fixing.
  failures.sort((a, b) => a.contrast - b.contrast);
  for (const f of failures) {
    console.log(
      `✗ ${String(f.contrast).padStart(5)}:1 (needs ${f.floor})  ${f.theme}  ${f.route}  ` +
        `<${f.tag}> ${Math.round(f.fontSize)}px  "${f.text}"${f.href ? `  → ${f.href}` : ""}`,
    );
  }
  console.log(`\n${failures.length} interactive label(s) below the AA floor`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
