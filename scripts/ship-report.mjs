/**
 * Ship report — the proof that goes with "done".
 * Run: pnpm run ship:report -- /loki --title "Build next" --focus '[aria-label="Build next"]'
 *      pnpm run ship:report -- /loki --commit a43d178 --wait 900     (wait for the deploy)
 *      SHIP_BASE=http://localhost:3000 pnpm run ship:report -- /loki --no-live
 *
 * WHY THIS EXISTS
 *
 * On 2026-10-11 "Build next" (#1141) was reported to the operator as: merged
 * at 21:14 UTC, "should go live on its own", "I haven't confirmed that, or
 * tried the screen in a browser myself", open /loki and tap a chip. Read on a
 * phone at 23:27. No link, no picture, no statement of what was checked — a
 * merge notice standing in for a result, and every rule this repo already
 * states ("confirm the commit is LIVE, not just merged"; "done means merged,
 * deployed and checked live") skipped because checking took tooling nobody
 * had wired together. This wires it together. One command, three answers:
 *
 *   1. IS IT LIVE — /api/health reports the commit the box is running
 *      (scripts/record-build-ref.sh stamps it at build time). Compared with
 *      the commit you shipped, never guessed from a timestamp.
 *   2. WHAT DOES IT LOOK LIKE — the real deployed page, phone first (390px,
 *      the width the operator reads on) and desktop, plus the one section
 *      you built cropped out when --focus names it. Console errors and 5xx
 *      responses while the page loaded are counted; a screenshot of a page
 *      whose data never arrived is not proof of anything.
 *   3. WHAT WAS AND WAS NOT CHECKED — written down, because "verified" with
 *      no list is the claim this file exists to replace.
 *
 * It writes REPORT.md next to the screenshots. Paste that report and attach
 * those files: that is the shape of a finished message
 * (docs/development/ship-report.md). It does not post anywhere itself.
 *
 * AUTH: the same session the responsive audit uses — LOKI_SESSION_TOKEN, or
 * AUDIT_DATABASE_URL + AUTH_SECRET (scripts/test/lib/session-cookie.mjs).
 * A public route needs none.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { config } from "dotenv";
import { mintSessionToken, sessionCookies } from "./test/lib/session-cookie.mjs";

config({ path: ".env.local", quiet: true });

const BASE = (
  process.env.SHIP_BASE ??
  process.env.LOKI_WEB_URL ??
  "https://loki.orangecat.ch"
).replace(/\/$/, "");
const OUT_ROOT = ".tmp/ship-report";
/** Phone first: it is where the operator reads the report. */
const VIEWPORTS = [
  { name: "390", width: 390, height: 844, touch: true },
  { name: "1440", width: 1440, height: 900, touch: false },
];
const HEALTH_POLL_MS = 20_000;
const SETTLE_MS = 1_200;

function parseArgs(argv) {
  const args = { route: null, commit: null, title: null, focus: null, wait: 0, live: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // `pnpm run ship:report -- /loki`: some runners forward the bare `--`.
    if (a === "--") continue;
    if (a.startsWith("/")) args.route = a;
    else if (a === "--commit") args.commit = argv[++i];
    else if (a === "--title") args.title = argv[++i];
    else if (a === "--focus") args.focus = argv[++i];
    else if (a === "--wait") args.wait = Number(argv[++i] ?? 0);
    else if (a === "--no-live") args.live = false;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!args.route) {
    console.error(
      "usage: pnpm run ship:report -- /route [--commit <sha>] [--title <text>] [--focus <css selector>] [--wait <seconds>] [--no-live]",
    );
    process.exit(2);
  }
  return args;
}

/** The commit that should be live: --commit, else origin/main. */
function expectedCommit(explicit) {
  if (explicit) return explicit;
  try {
    execSync("git fetch -q origin main", { stdio: "ignore", timeout: 30_000 });
  } catch {
    // Offline is fine: the local ref is the fallback, and the report says which.
  }
  try {
    return execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function readHealth() {
  try {
    const res = await fetch(`${BASE}/api/health`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    return { status: res.status, commit: body?.commit ?? null, app: body?.app ?? null };
  } catch (err) {
    return { status: 0, commit: null, app: null, error: String(err?.message ?? err) };
  }
}

/** True when `ancestor` is in `commit`'s history — main having moved on past
 *  the shipped commit is still live, and the report must not call it behind. */
function isAncestor(ancestor, commit) {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${commit}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * live:     the box reports the expected commit, or one that contains it
 * behind:   it reports another one (deploy pending, or never happened)
 * unknown:  it reports none — a dev server or a build without the marker
 * down:     /api/health did not answer
 */
async function checkLive(expected, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = await readHealth();
  const matches = (h) =>
    Boolean(
      expected &&
      h.commit &&
      (h.commit.startsWith(expected) ||
        expected.startsWith(h.commit) ||
        isAncestor(expected, h.commit)),
    );
  while (!matches(last) && Date.now() < deadline) {
    const left = Math.round((deadline - Date.now()) / 1000);
    console.log(
      `  … live is ${last.commit?.slice(0, 7) ?? "unknown"}, waiting for ${expected?.slice(0, 7)} (${left}s left)`,
    );
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    last = await readHealth();
  }
  const state =
    last.status === 0
      ? "down"
      : last.commit === null
        ? "unknown"
        : matches(last)
          ? "live"
          : "behind";
  return { state, ...last, expected };
}

async function capture(route, focus, token, outDir, slug) {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const shots = [];
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        deviceScaleFactor: 1,
      });
      await ctx.addCookies(sessionCookies(BASE, token));
      const page = await ctx.newPage();
      const consoleErrors = [];
      const serverErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120));
      });
      page.on("response", (r) => {
        if (r.url().startsWith(BASE) && r.status() >= 500) {
          serverErrors.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 70)}`);
        }
      });
      const shot = {
        viewport: vp.name,
        status: 0,
        landed: null,
        file: null,
        focusFile: null,
        focusCount: null,
        consoleErrors,
        serverErrors,
      };
      try {
        const nav = await page.goto(`${BASE}${route}`, {
          waitUntil: "networkidle",
          timeout: 45_000,
        });
        shot.status = nav?.status() ?? 0;
        await page.waitForTimeout(SETTLE_MS);
        shot.landed = new URL(page.url()).pathname;
        shot.file = path.join(outDir, `${slug}-${vp.name}.png`);
        await page.screenshot({ path: shot.file, fullPage: false });
        if (focus) {
          const loc = page.locator(focus).first();
          shot.focusCount = await page.locator(focus).count();
          if (shot.focusCount > 0) {
            await loc.scrollIntoViewIfNeeded().catch(() => undefined);
            shot.focusFile = path.join(outDir, `${slug}-focus-${vp.name}.png`);
            await loc.screenshot({ path: shot.focusFile });
          }
        }
      } catch (err) {
        shot.error = String(err?.message ?? err)
          .split("\n")[0]
          .slice(0, 160);
      }
      shots.push(shot);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return shots;
}

function renderReport({ args, live, shots, token, outDir }) {
  const url = `${BASE}${args.route}`;
  const title = args.title ?? args.route;
  const lines = [`# Ship report — ${title}`, "", `**Live:** ${url}`, ""];

  if (!args.live) {
    lines.push(`**Deployed:** not checked (--no-live).`);
  } else if (live.state === "live") {
    const same =
      live.expected &&
      (live.commit.startsWith(live.expected) || live.expected.startsWith(live.commit));
    lines.push(
      same
        ? `**Deployed:** yes — ${BASE} reports commit ${live.commit.slice(0, 7)}, the one shipped.`
        : `**Deployed:** yes — ${BASE} reports commit ${live.commit.slice(0, 7)}, which contains the shipped ${live.expected.slice(0, 7)}.`,
    );
  } else if (live.state === "behind") {
    lines.push(
      `**Deployed:** NOT YET — ${BASE} reports ${live.commit.slice(0, 7)}, shipped ${live.expected?.slice(0, 7) ?? "?"}. The page below is the OLD build.`,
    );
  } else if (live.state === "unknown") {
    lines.push(
      `**Deployed:** cannot tell — ${BASE} reports no build commit (dev server, or a build without .build-ref).`,
    );
  } else {
    lines.push(
      `**Deployed:** unknown — ${BASE}/api/health did not answer (${live.error ?? "no response"}).`,
    );
  }
  lines.push("");

  lines.push("**Screenshots** (real page, as deployed):");
  for (const s of shots) {
    if (s.error) {
      lines.push(`- ${s.viewport}px: FAILED — ${s.error}`);
      continue;
    }
    const where = s.landed && s.landed !== args.route ? ` (landed on ${s.landed})` : "";
    lines.push(`- ${s.viewport}px: ${s.file}${where}`);
    if (args.focus) {
      lines.push(
        s.focusFile
          ? `  - focus \`${args.focus}\`: ${s.focusFile} (${s.focusCount} match${s.focusCount === 1 ? "" : "es"})`
          : `  - focus \`${args.focus}\`: NOT FOUND on the page`,
      );
    }
  }
  lines.push("");

  const checked = [];
  const notChecked = [];
  if (args.live)
    checked.push(
      `the running site's build commit against ${live.expected?.slice(0, 7) ?? "origin/main"}`,
    );
  else notChecked.push("whether the build is live (--no-live)");
  const okShots = shots.filter((s) => !s.error);
  if (okShots.length) {
    checked.push(
      `${args.route} renders at ${okShots.map((s) => `${s.viewport}px`).join(" and ")} (HTTP ${[...new Set(okShots.map((s) => s.status))].join("/")})`,
    );
    const ce = okShots.reduce((n, s) => n + s.consoleErrors.length, 0);
    const se = okShots.reduce((n, s) => n + s.serverErrors.length, 0);
    checked.push(
      `${ce} console error${ce === 1 ? "" : "s"}, ${se} 5xx response${se === 1 ? "" : "s"} while loading`,
    );
    if (ce)
      lines.push(
        `Console errors: ${[...new Set(okShots.flatMap((s) => s.consoleErrors))].slice(0, 5).join(" | ")}`,
        "",
      );
    if (se)
      lines.push(
        `Server errors: ${[...new Set(okShots.flatMap((s) => s.serverErrors))].slice(0, 5).join(" | ")}`,
        "",
      );
  }
  if (args.focus) {
    const found = okShots.some((s) => s.focusFile);
    (found ? checked : notChecked).push(
      found
        ? `the section \`${args.focus}\` is on the page`
        : `the section \`${args.focus}\` — not found`,
    );
  } else {
    notChecked.push("that the specific thing built is on the page (pass --focus <selector>)");
  }
  if (!token)
    notChecked.push(
      "anything behind sign-in (no session: set LOKI_SESSION_TOKEN or AUDIT_DATABASE_URL + AUTH_SECRET)",
    );
  notChecked.push(
    "that it behaves — a screenshot shows a state, not a flow; say what you tried by hand",
  );

  lines.push(
    "**Checked:**",
    ...checked.map((c) => `- ${c}`),
    "",
    "**Not checked:**",
    ...notChecked.map((c) => `- ${c}`),
    "",
  );
  lines.push(`_${new Date().toISOString()} · ${outDir}_`);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug =
    args.route
      .replace(/^\//, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/-$/, "") || "root";
  const outDir = path.join(OUT_ROOT, slug);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`ship report · ${BASE}${args.route}`);
  const live = args.live ? await checkLive(expectedCommit(args.commit), args.wait) : null;
  if (live)
    console.log(`  deploy: ${live.state}${live.commit ? ` (${live.commit.slice(0, 7)})` : ""}`);

  const token = await mintSessionToken(BASE);
  if (!token) console.log("  no session — capturing as a signed-out visitor");
  const shots = await capture(args.route, args.focus, token, outDir, slug);

  const report = renderReport({ args, live, shots, token, outDir });
  const reportPath = path.join(outDir, "REPORT.md");
  fs.writeFileSync(reportPath, `${report}\n`);
  console.log(`\n${report}\n`);

  const pageOk = shots.some((s) => !s.error && s.status < 400);
  const focusOk = !args.focus || shots.some((s) => s.focusFile);
  const liveOk = !args.live || live.state === "live";
  if (!(pageOk && focusOk && liveOk)) {
    console.error(
      `✗ not a finished ship: ${[!liveOk && "not live", !pageOk && "page did not render", !focusOk && "section not found"].filter(Boolean).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`✓ report written: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
