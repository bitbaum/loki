/**
 * Responsive audit — the automated check behind "every page works at 320px+".
 * Run: npm run audit:responsive            (all pages, default viewports)
 *      npm run audit:responsive -- /loki   (one page)
 *
 * WHY THIS EXISTS
 *
 * CLAUDE.md states the rule — "All pages must work at 320px+ without horizontal
 * scroll" — and nothing enforced it for AUTHENTICATED pages. Every existing
 * check either runs unauthenticated (smoke) or at a single desktop width
 * (dogfood). So the rule was a promise, and layout regressions on the pages the
 * operator actually uses could ship green.
 *
 * It surfaced concretely: a Loki layout change could not be verified across
 * viewports at all, because `resize_window` in the interactive browser does not
 * take effect under a tiling window manager (outerWidth stays put), and the
 * repo's headless tooling needs a session token that needs the database.
 * Reasoning about breakpoints from CSS is not verification.
 *
 * WHAT IT CHECKS, per page per viewport:
 *   1. No horizontal overflow — scrollWidth must not exceed the viewport. This
 *      is the stated rule, and the one that makes a phone unusable.
 *   2. Which element overflowed, when one does. A bare "320 fails" costs an
 *      hour of bisecting; the offender's tag + classes costs nothing to report.
 *   3. Touch targets >= 44px on coarse-pointer widths. Also a stated rule, and
 *      invisible in a screenshot.
 *   4. A screenshot per page/viewport under .tmp/responsive-audit/ for eyeballs.
 *
 * AUTH
 *
 * Needs a session. Resolution order:
 *   LOKI_SESSION_TOKEN  — set it and nothing else is needed
 *   AUDIT_DATABASE_URL        — mints a JWT itself (see scripts/db-tunnel.sh
 *                               for reaching a firewalled Postgres over SSH)
 * Deliberately NOT reusing print-session-token.ts: that resolves a DIRECT box
 * connection from .env.hetzner.local, which is exactly what is unreachable from
 * a sandboxed or CI runner. Taking the URL explicitly is what makes this
 * runnable from somewhere other than the founder's laptop.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE = (process.env.AUDIT_BASE ?? "https://loki.orangecat.ch").replace(/\/$/, "");
const OUT = ".tmp/responsive-audit";
/** Optional CSS injected into every page before measuring — see the call site. */
const EXTRA_CSS = process.env.AUDIT_EXTRA_CSS
  ? fs.readFileSync(process.env.AUDIT_EXTRA_CSS, "utf8")
  : null;

/**
 * React's hydration failures, in both shapes.
 * Production ships minified errors, so #418/#423/#425 is all you get and the
 * number IS the message; dev builds print prose instead. Matching only one form
 * means the check works in exactly the environment you are not auditing.
 */
const HYDRATION_ERROR =
  /Minified React error #(418|419|421|422|423|425)|[Hh]ydration failed|did not match the server|Text content does not match/;

/**
 * Widths that represent real failure classes, not a sweep.
 * 320 is the narrowest phone still in use and the stated floor; 390 is a modern
 * iPhone; 768 is the tablet/sidebar boundary; 1440 is the laptop most of this
 * gets designed on. Each is a breakpoint where THIS app changes behaviour.
 */
const VIEWPORTS = [
  { name: "320", width: 320, height: 720, touch: true },
  { name: "390", width: 390, height: 844, touch: true },
  { name: "768", width: 768, height: 1024, touch: true },
  { name: "1440", width: 1440, height: 900, touch: false },
];

/**
 * Every authenticated surface reachable from the nav, plus the sub-routes that
 * carry their own layout. Auditing five pages proved the harness; auditing the
 * whole app is what actually protects it — a rule enforced on a sample is a rule
 * with holes exactly where nobody looked.
 *
 * Public/marketing routes USED to be excluded here, deferred to `npm run smoke`
 * "which already covers them". It does not: smoke curls each route and asserts
 * a 2xx/3xx status. A status code says nothing about a layout, so the pages
 * every stranger sees FIRST were the only ones in the product with no
 * responsive coverage at all — the exact hole this file's own comment warns
 * about, in the one place nobody was looking. Measured when finally audited:
 * 19 sub-44px tap targets on /fleet, every one of them the site address that
 * is the whole point of the row. They are in PUBLIC_PAGES below now, and they
 * need no session, so they cost nothing to keep honest.
 */
/**
 * FIVE of the twenty entries that used to be here were `redirect()` stubs:
 * /agents and /atlas (retired, → /control and /projects), /digests, /decisions
 * and /history (→ /activity). So a "20 route" report was really 15 pages, four
 * of them measured twice under a name they no longer own — a 25% coverage
 * overstatement that nothing surfaced, because a redirect renders a real page
 * and passes. Two of them did worse than lie: the redirect raced the
 * measurement, and one run hung while another reported the context destroyed.
 *
 * The `landed elsewhere` note in the report is the detector, so the next
 * retirement shows up as a line of output instead of silent double-counting.
 */
/**
 * The private-zone pages (/people, /money, /habits, /events, /goals, /memory)
 * were missing from this list, and from the smoke's probes, and from the UI
 * dogfood's flows. One cause behind all three: they sit behind the PIN, so
 * measuring them without an unlock measures a lock screen, and each check quietly
 * dropped them instead. A rule enforced on the pages that happened to be
 * reachable is a rule with holes exactly where nobody looked — which is the
 * comment above this list, so the list has to earn it.
 *
 * LOKI_PRIVATE_ZONE_COOKIE (scripts/test/print-private-zone-cookie.ts)
 * supplies the unlock. Without it these pages still render — as their lock
 * screen — so the audit degrades to what it measured before rather than failing.
 */
const PAGES = [
  "/today",
  "/loki",
  "/control",
  "/projects",
  "/approvals",
  // /feedback and /robots were reachable from the sidebar and audited by
  // neither list — the same hole the paragraph above describes, still open.
  // /feedback is where an operator spends the triage half of their day, and its
  // per-row action cluster is the densest control group in the app.
  "/feedback",
  "/robots",
  "/terminal",
  "/prompts",
  "/activity",
  "/system",
  "/thoughts",
  "/settings",
  "/frontier",
  "/integrations/orangecat/build",
  "/control/import",
  "/control/new-from-scratch",
  "/people",
  "/crew",
  "/money",
  "/habits",
  "/events",
  "/goals",
  "/memory",
];

/**
 * Unauthenticated routes. Audited with NO session — that is the point: this is
 * what a stranger gets, so measuring it while signed in would measure a
 * different page (the landing redirects a signed-in operator straight to the
 * app). Kept separate from PAGES for that reason, not for tidiness.
 */
const PUBLIC_PAGES = [
  "/",
  "/fleet",
  "/pricing",
  "/download",
  "/mission",
  "/philosophy",
  "/roadmap",
  "/investors",
  "/whitepaper",
  "/thoughts",
  "/changelog",
  "/support",
  "/docs",
  "/sign-in",
  "/sign-up",
];

const isPublicPage = (p) => PUBLIC_PAGES.includes(p);

const MIN_TOUCH_PX = 44;

function cookieName() {
  return BASE.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/** Mint a session JWT from an explicitly-supplied Postgres URL. */
async function mintToken() {
  const fromEnv = process.env.LOKI_SESSION_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const dbUrl = process.env.AUDIT_DATABASE_URL?.trim();
  const secret = process.env.AUTH_SECRET?.trim();
  if (!dbUrl || !secret) return null;

  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1, ssl: false });
  try {
    const rows = await sql`
      SELECT id, email, name, username, onboarded_at
      FROM users
      WHERE is_default = true OR email IS NOT NULL
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    const u = rows[0];
    if (!u?.id) return null;
    const { encode } = await import("@auth/core/jwt");
    return await encode({
      token: {
        id: u.id,
        email: u.email,
        name: u.name,
        username: u.username,
        onboardedAt: u.onboarded_at,
        onboardingComplete: Boolean(u.username && u.onboarded_at),
        sub: u.id,
      },
      secret,
      salt: cookieName(),
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

/**
 * Measure one rendered page. Runs in the browser: reports overflow with the
 * culprit, and undersized touch targets.
 *
 * `scrollWidth > clientWidth + 1` — the 1px slack absorbs sub-pixel rounding at
 * fractional device ratios, which otherwise reports a phantom overflow on every
 * page and trains everyone to ignore the check.
 *
 * A real function, not a string: Playwright does not bind arguments to a string
 * pageFunction, so the string form silently received `undefined` for minTouch
 * and returned nothing at all.
 */
function measurePage(minTouch) {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden") return false;
      return r.right > vw + 1;
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 80),
      right: Math.round(el.getBoundingClientRect().right),
      width: Math.round(el.getBoundingClientRect().width),
    }))
    .sort((a, b) => b.right - a.right)
    .slice(0, 5);

  // What the FINGER hits, which is repeatedly NOT the control's own box:
  //   • a 14px checkbox inside a 60px <label> — the whole label is clickable
  //   • a 16x28 switch with an ::after overlay extending the hit area to 44px
  // Measuring only the element's rect reported both as failures.
  //
  // The obvious fix — document.elementFromPoint on a 44px cross — is WRONG, and
  // shipping it cost a full production run: elementFromPoint is viewport-only,
  // so every control below the fold returned null and the report filled up with
  // 44px, 55px and 65px "offenders". A measurement that depends on scroll
  // position is not a measurement. So resolve the hit area from geometry, which
  // is what the two real techniques above actually change.
  const overlayBox = (el) => {
    for (const pseudo of ["::after", "::before"]) {
      const cs = getComputedStyle(el, pseudo);
      if (!cs || cs.content === "none" || (cs.position !== "absolute" && cs.position !== "fixed"))
        continue;
      const h = Math.max(parseFloat(cs.height) || 0, parseFloat(cs.minHeight) || 0);
      const w = Math.max(parseFloat(cs.width) || 0, parseFloat(cs.minWidth) || 0);
      if (h > 0 || w > 0) return { height: h, width: w };
    }
    return null;
  };

  const hitBox = (el) => {
    const own = el.getBoundingClientRect();
    let best = { height: own.height, width: own.width };
    // A wrapping <label> (or one pointing here with `for`) IS the hit area.
    if (/^(input|select|textarea)$/i.test(el.tagName)) {
      let lab = el.closest("label");
      if (!lab && el.id) {
        try {
          lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        } catch {
          lab = null;
        }
      }
      if (lab) {
        const lr = lab.getBoundingClientRect();
        if (lr.height > best.height) best = { height: lr.height, width: lr.width };
      }
    }
    const ov = overlayBox(el);
    if (ov && ov.height > best.height) best = ov;
    return best;
  };

  const small = [...document.querySelectorAll('button, a[href], [role="button"], input, select')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0" || cs.pointerEvents === "none")
        return false;
      // WCAG 2.5.8's inline exception: a link INSIDE a sentence cannot be given
      // a 44px box without wrecking the paragraph, and the surrounding text is
      // what makes it findable. Only genuinely inline links in flowing text —
      // a link that is a flex item has been blockified and is not this.
      if (el.tagName === "A" && cs.display === "inline") {
        const parentText = (el.parentElement?.textContent || "").trim().length;
        const ownText = (el.textContent || "").trim().length;
        if (parentText > ownText + 12) return false;
      }
      return hitBox(el).height < minTouch - 0.5;
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 28),
      // The class is what you actually fix. Without it every finding needs a
      // reverse hunt from a truncated label back to a component.
      cls:
        ((el.className || "").toString().match(/ui-[\w-]+/g) || []).join(".") ||
        (el.className || "").toString().slice(0, 40),
      h: Math.round(hitBox(el).height),
    }))
    .slice(0, 12);

  // Text clipped by a fixed-height box: content the operator simply cannot
  // read, and invisible to an overflow check because the container itself fits.
  const clipped = [...document.querySelectorAll("body *")]
    .filter((el) => {
      if (el.children.length > 0) return false;
      const t = (el.textContent || "").trim();
      if (t.length < 12) return false;
      const cs = getComputedStyle(el);
      if (cs.overflow === "visible" || cs.visibility === "hidden") return false;
      // Ellipsis is a deliberate design choice; genuine vertical clipping is not.
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth) return false;
      // line-clamp is the VERTICAL ellipsis and is just as deliberate. Without
      // this the audit reported every summary card in the app as clipped —
      // "(-1014px)" on a line-clamp-2 prompt preview, which is the feature
      // working. That noise is what made the clipped-text section unreadable,
      // and an unreadable section hides the real clipping underneath it.
      if (cs.webkitLineClamp && cs.webkitLineClamp !== "none") return false;
      return el.scrollHeight > el.clientHeight + 2;
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 30),
      cls:
        ((el.className || "").toString().match(/ui-[\w-]+/g) || []).join(".") ||
        (el.className || "").toString().slice(0, 40),
      hidden: el.scrollHeight - el.clientHeight,
    }))
    .slice(0, 5);

  // A SENTENCE cut off by a single-line ellipsis.
  //
  // The vertical check above deliberately exempts `text-overflow: ellipsis`,
  // and that exemption is right for what it was written for: a project name in
  // a narrow rail, a filename, an id. Truncating an identifier is a normal
  // affordance — you still recognise it, and 76 files in src/components use
  // `truncate` for exactly that. A blanket rule would fire on all of them.
  //
  // It is not right for prose. /control's "Suggested next (profile): …" line
  // showed 50 of its 644 pixels — the rest lived only in a `title` tooltip, and
  // a phone has no hover. Clicking that line loads it into the composer, so the
  // sentence was the decision and a tenth of a sentence is not one.
  //
  // Three conditions keep this narrow enough to stay silent on the legitimate
  // cases: the text must READ as a sentence (long, many spaces — an id has
  // neither), and more than half of it must be hidden (a chip losing its tail
  // is fine; a line showing its first eight words is not).
  const PROSE_MIN_CHARS = 60;
  const PROSE_MIN_SPACES = 8;
  const PROSE_MAX_VISIBLE_FRACTION = 0.5;
  const clippedProse = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.textOverflow !== "ellipsis" || cs.whiteSpace !== "nowrap") return false;
      if (cs.visibility === "hidden") return false;
      const t = (el.textContent || "").trim();
      if (t.length < PROSE_MIN_CHARS) return false;
      if ((t.match(/\s/g) || []).length < PROSE_MIN_SPACES) return false;
      const full = el.scrollWidth;
      if (full <= el.clientWidth + 2 || full === 0) return false;
      return el.clientWidth / full < PROSE_MAX_VISIBLE_FRACTION;
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 44),
      cls:
        ((el.className || "").toString().match(/ui-[\w-]+/g) || []).join(".") ||
        (el.className || "").toString().slice(0, 40),
      hidden: el.scrollWidth - el.clientWidth,
      shownPct: Math.round((el.clientWidth / el.scrollWidth) * 100),
    }))
    .slice(0, 5);

  // A line-clamp that is DECLARED but does nothing.
  //
  // `-webkit-line-clamp` is inert unless the box is `display: -webkit-box`,
  // which the line-clamp utility sets — and Tailwind's `block` utility
  // overrides. `block ... line-clamp-2` computes to `display: block;
  // -webkit-line-clamp: 2` and clamps nothing. It shipped here once, on
  // /control's "Suggested next" line, and looked fixed: with no clamp the text
  // simply wraps, which reads fine until a long one arrives and shoves the
  // composer off the viewport.
  //
  // The clipped-prose check above cannot see this — that measures a HORIZONTAL
  // ellipsis, and this failure has none. Nor can `display === "-webkit-box"`:
  // Chrome reported `flow-root` for a clamp that was working correctly, so the
  // declared display is not a reliable signal either way.
  //
  // So test the BEHAVIOUR: an element declaring N lines that renders more than
  // N is a clamp that is not being enforced. Requires no knowledge of how the
  // browser normalises display.
  const deadClamps = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const cs = getComputedStyle(el);
      const n = parseInt(cs.webkitLineClamp, 10);
      if (!Number.isFinite(n) || n < 1) return false;
      if (cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) return false;
      const lh = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lh) || lh <= 0) return false;
      // Half a line of slack absorbs padding and sub-pixel rounding.
      return el.clientHeight / lh > n + 0.5;
    })
    .map((el) => {
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 40),
        cls:
          ((el.className || "").toString().match(/(ui-[\w-]+|line-clamp-\d+|block)/g) || []).join(
            ".",
          ) || (el.className || "").toString().slice(0, 40),
        declared: parseInt(cs.webkitLineClamp, 10),
        rendered: Math.round(el.clientHeight / parseFloat(cs.lineHeight)),
        display: cs.display,
      };
    })
    .slice(0, 5);

  // Content trapped under fixed chrome (mobile bottom nav). Reachable only if
  // the page scrolls far enough; on a short page it is permanently covered.
  const bars = [...document.querySelectorAll("body *")].filter((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      cs.position === "fixed" &&
      r.height > 24 &&
      r.width > vw * 0.6 &&
      r.bottom >= de.clientHeight - 2
    );
  });
  const barTop = bars.length
    ? Math.min(...bars.map((b) => b.getBoundingClientRect().top))
    : Infinity;
  const buried =
    bars.length === 0
      ? []
      : [...document.querySelectorAll("button, a[href], input, select")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.height === 0 || getComputedStyle(el).position === "fixed") return false;
            // Intersects the bar AND the page cannot scroll further to free it.
            return (
              r.bottom > barTop && r.top < de.clientHeight && de.scrollHeight <= de.clientHeight + 2
            );
          })
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
          }))
          .slice(0, 4);

  const brokenImages = [...document.querySelectorAll("img")]
    .filter(
      (img) => img.complete && img.naturalWidth === 0 && (img.getAttribute("src") || "").length > 0,
    )
    .map((img) => (img.getAttribute("src") || "").slice(0, 60))
    .slice(0, 4);

  return {
    vw,
    scrollWidth: de.scrollWidth,
    overflow: de.scrollWidth > vw + 1,
    offenders,
    small,
    clipped,
    clippedProse,
    deadClamps,
    buried,
    brokenImages,
  };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => a.startsWith("/"));
  const pages = only.length > 0 ? only : [...PUBLIC_PAGES, ...PAGES];

  // A session is needed only for the authenticated half. Demanding one up front
  // meant the public pages — which need none — could not be audited without
  // credentials, which is a large part of why they never were.
  const needsSession = pages.some((p) => !isPublicPage(p));
  const token = needsSession ? await mintToken() : null;
  if (needsSession && !token) {
    console.error(
      "✗ no session. Set LOKI_SESSION_TOKEN, or AUDIT_DATABASE_URL + AUTH_SECRET.\n" +
        "  For a firewalled Postgres: bash scripts/db-tunnel.sh   (prints the URL to use)\n" +
        "  Public routes need no session: pass them as arguments, e.g. `/ /fleet`.",
    );
    process.exit(2);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  const notes = [];
  let checks = 0;

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      deviceScaleFactor: 1,
    });
    // No token when auditing only public routes — and a cookie with an
    // undefined value is not "no cookie", it is a malformed one that Playwright
    // rejects. So the session cookie is added only when there is a session.
    const cookies = token
      ? [
          {
            name: cookieName(),
            value: token,
            domain: new URL(BASE).hostname,
            path: "/",
            httpOnly: true,
            secure: BASE.startsWith("https://"),
          },
        ]
      : [];
    const pz = process.env.LOKI_PRIVATE_ZONE_COOKIE?.trim();
    const pzEq = pz ? pz.indexOf("=") : -1;
    if (pzEq > 0) {
      cookies.push({
        name: pz.slice(0, pzEq),
        value: pz.slice(pzEq + 1),
        domain: new URL(BASE).hostname,
        path: "/",
        httpOnly: true,
        secure: BASE.startsWith("https://"),
      });
    }
    await ctx.addCookies(cookies);

    for (const route of pages) {
      const page = await ctx.newPage();
      // Console + network failures are free to collect while the page is open
      // and are the cheapest signal that a surface is quietly broken — an audit
      // that only measures boxes will pass a page whose data never loaded.
      const consoleErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120));
      });
      page.on("pageerror", (e) =>
        consoleErrors.push(`uncaught: ${String(e.message).slice(0, 120)}`),
      );
      const httpFailures = [];
      // 4xx is tracked SEPARATELY and by URL. The first run of this audit
      // reported "400 responses on /settings and /thoughts" and that was all it
      // could say, because a 4xx only reached the log as the browser's generic
      // "Failed to load resource" console line — truncated, with no path. A
      // request your own app made and your own server rejected is a bug you
      // cannot act on without knowing which one it was.
      // Same-origin only: a 4xx from a third party is their problem, and 404s
      // for things like favicons are noise, not findings.
      const badRequests = [];
      page.on("response", (r) => {
        const s = r.status();
        const url = r.url();
        if (!url.startsWith(BASE)) return;
        if (s >= 500) httpFailures.push(`${s} ${url.replace(BASE, "").slice(0, 70)}`);
        else if (s >= 400 && s !== 404)
          badRequests.push(`${s} ${url.replace(BASE, "").slice(0, 70)}`);
      });
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
        // AUDIT_EXTRA_CSS: measure a stylesheet change against PRODUCTION
        // markup, before shipping it. A design-system rule is only correct in
        // contact with real pages in real states, and the alternatives are both
        // bad: ship it and find out (this file exists because that cost a full
        // production run), or stand up a local build — which measures a
        // different database, and, on the day this was added, silently measured
        // a DIFFERENT APP because another process already held the port.
        // Injecting into the live page changes exactly one variable.
        if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
        // Let late layout (fonts, async panes) settle before measuring — a
        // measurement taken mid-hydration reports overflow that never reaches a
        // human eye, and a flaky gate is a disabled gate.
        await page.waitForTimeout(1200);

        // A page that navigates AFTER networkidle — an auth refresh, an
        // onboarding guard, a client-side redirect — destroys the execution
        // context mid-measurement, and the run reports the route as a failure
        // it is not. Seen on /history and then on /decisions: the route moved
        // between runs, which is the signature of a race rather than a layout
        // fault. Settle and measure once more; a gate that cries wolf is a gate
        // someone learns to ignore.
        let r;
        try {
          r = await page.evaluate(measurePage, MIN_TOUCH_PX);
        } catch (err) {
          if (!/Execution context was destroyed/.test(String(err?.message))) throw err;
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
          await page.waitForTimeout(1200);
          if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
          r = await page.evaluate(measurePage, MIN_TOUCH_PX);
        }
        checks++;
        // A route that lands somewhere else is measuring a page it does not
        // name. Not a failure — redirects are legitimate — but it must be SAID,
        // or the list rots into aliases and the report credits coverage it
        // never had.
        const landed = new URL(page.url()).pathname;
        if (landed !== route) notes.push(`${route} @${vp.name}: landed on ${landed}`);
        const shot = path.join(OUT, `${route.replace(/\//g, "") || "root"}-${vp.name}.png`);
        await page.screenshot({ path: shot, fullPage: false });

        // HARD failures: the page is broken, not merely imperfect.
        if (r.overflow) {
          failures.push(
            `${route} @${vp.name}: horizontal overflow ${r.scrollWidth}px > ${r.vw}px\n` +
              r.offenders
                .map((o) => `      ${o.tag}.${o.cls} (right=${o.right}, w=${o.width})`)
                .join("\n"),
          );
          console.log(`  ✗ ${route} @${vp.name}px — overflow ${r.scrollWidth} > ${r.vw}`);
        } else if (httpFailures.length > 0) {
          failures.push(
            `${route} @${vp.name}: server error(s) — ${httpFailures.slice(0, 3).join("; ")}`,
          );
          console.log(`  ✗ ${route} @${vp.name}px — ${httpFailures[0]}`);
        } else if (r.buried.length > 0) {
          failures.push(
            `${route} @${vp.name}: control(s) trapped under fixed chrome on an unscrollable page — ${r.buried.map((b) => `${b.tag}"${b.label}"`).join(", ")}`,
          );
          console.log(
            `  ✗ ${route} @${vp.name}px — ${r.buried.length} control(s) buried under the bottom bar`,
          );
        } else if (vp.touch && r.small.length > 0) {
          // Reported, not failed: the 44px rule has legitimate exceptions
          // (inline text links), and failing on it would bury the overflow
          // signal that actually breaks a page.
          console.log(
            `  ⚠ ${route} @${vp.name}px — ${r.small.length} target(s) under ${MIN_TOUCH_PX}px: ${r.small.map((s) => `${s.tag}"${s.label}"[${s.cls}]=${s.h}px`).join(", ")}`,
          );
        } else {
          console.log(`  ✓ ${route} @${vp.name}px`);
        }
        // Soft signals, always reported alongside the verdict above.
        if (r.clipped.length > 0)
          console.log(
            `     ⚠ clipped text: ${r.clipped.map((c) => `"${c.text}"[${c.cls}] (-${c.hidden}px)`).join(", ")}`,
          );
        if (r.clippedProse.length > 0)
          console.log(
            `     ⚠ sentence cut off by a single-line ellipsis (the rest is hover-only, so a phone cannot read it): ${r.clippedProse
              .map((c) => `"${c.text}…"[${c.cls}] ${c.shownPct}% shown, -${c.hidden}px`)
              .join(", ")}`,
          );
        if (r.deadClamps.length > 0)
          console.log(
            `     ⚠ line-clamp declared but NOT enforced (a \`block\`/display utility beats it — the box grows instead): ${r.deadClamps
              .map(
                (c) =>
                  `"${c.text}…"[${c.cls}] declared ${c.declared} lines, renders ${c.rendered} (display:${c.display})`,
              )
              .join(", ")}`,
          );
        if (r.brokenImages.length > 0)
          console.log(`     ⚠ broken image(s): ${r.brokenImages.join(", ")}`);
        if (badRequests.length > 0)
          console.log(
            `     ⚠ rejected request(s): ${[...new Set(badRequests)].slice(0, 4).join(" | ")}`,
          );
        // Hydration errors get their own line rather than being one of two
        // truncated console strings. They are never cosmetic: the server sent
        // markup the browser disagreed with, so SOMETHING on the page rendered
        // from state the server could not have — a clock, a locale, a random
        // id, a width. The user sees the wrong content before React repairs it.
        const hydration = [...new Set(consoleErrors)].filter((m) => HYDRATION_ERROR.test(m));
        if (hydration.length > 0) console.log(`     ⚠ HYDRATION MISMATCH: ${hydration[0]}`);
        if (consoleErrors.length > 0)
          console.log(`     ⚠ console: ${[...new Set(consoleErrors)].slice(0, 2).join(" | ")}`);
      } catch (e) {
        failures.push(`${route} @${vp.name}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
        console.log(
          `  ✗ ${route} @${vp.name}px — ${e instanceof Error ? e.message.slice(0, 80) : e}`,
        );
      } finally {
        await page.close();
      }
    }
    await ctx.close();
  }
  await browser.close();

  console.log(`\n${checks} check(s) across ${VIEWPORTS.length} viewports · screenshots in ${OUT}/`);
  if (notes.length > 0) {
    console.log(`\nnote — ${notes.length} route(s) did not measure what they name:`);
    for (const n of notes) console.log(`  · ${n}`);
  }
  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} responsive failure(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("✓ no horizontal overflow at any tested width");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
