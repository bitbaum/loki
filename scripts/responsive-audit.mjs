import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const outDir = path.join(root, ".tmp", "responsive-audit");
fs.mkdirSync(outDir, { recursive: true });

function readLocalEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1).replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

readLocalEnv();

const base = process.env.BASE ?? "http://localhost:3002";
const ownerPassword = process.env.LOCAL_AUTH_PASSWORD;
const dogfoodEmail = process.env.DOGFOOD_EMAIL;
const dogfoodPassword = process.env.DOGFOOD_PASSWORD;
const isLocal = base.includes("localhost") || base.includes("127.0.0.1");
const routes = [
  "/today",
  "/control",
  "/loki",
  "/terminal?source=server&tab=loki",
  "/projects",
  "/prompts",
  // Both feedback surfaces. The reporter page shipped an unclamped report body
  // that swallowed the list at phone width for two days; neither page was ever
  // driven through a viewport here.
  "/feedback",
  "/my-feedback",
  "/activity",
  "/history",
  "/decisions",
  "/system",
  "/settings",
  "/people",
  "/crew",
  "/goals",
  "/habits",
  "/events",
  "/money",
  "/thoughts",
];

const viewports = [
  { name: "mobile", width: 390, height: 844, isMobile: true },
  { name: "desktop", width: 1440, height: 1000, isMobile: false },
];

function slug(route) {
  return route.replace(/^\//, "").replace(/\//g, "-") || "home";
}

async function login(page) {
  await page.goto(`${base}/sign-in?callbackUrl=/today`, { waitUntil: "domcontentloaded" });
  if (isLocal) {
    const ownerTab = page.getByRole("button", { name: /owner key/i });
    if (await ownerTab.count()) await ownerTab.click();
    if (!ownerPassword) throw new Error("LOCAL_AUTH_PASSWORD is not configured");
    await page.locator('input[type="password"]').first().fill(ownerPassword);
  } else {
    if (!dogfoodEmail || !dogfoodPassword)
      throw new Error("DOGFOOD_EMAIL/DOGFOOD_PASSWORD required for production audit");
    await page.locator('input[type="email"]').first().fill(dogfoodEmail);
    await page.locator('input[type="password"]').first().fill(dogfoodPassword);
  }
  await page
    .getByRole("button", { name: /sign in|continue|unlock/i })
    .last()
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15000 });
}

async function analyze(page, viewportName) {
  return page.evaluate((vpName) => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const body = document.body;
    const doc = document.documentElement;
    const all = [...document.querySelectorAll("*")];

    const textNodes = all
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        return {
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 80),
          size: parseFloat(style.fontSize),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
        };
      })
      .filter((x) => x.visible && x.text && x.size > 0 && x.size < (vpName === "mobile" ? 12 : 11))
      .slice(0, 30);

    const overflow = all
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        return {
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === "string" ? el.className.slice(0, 120) : "",
          text: text.slice(0, 80),
          right: Math.round(rect.right),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
        };
      })
      .filter((x) => x.visible && (x.right > vw + 2 || x.left < -2))
      .slice(0, 30);

    const targets = all
      .filter((el) => el.matches("button,a,input,select,textarea,[role='button']"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = (
          el.getAttribute("aria-label") ||
          el.textContent ||
          el.getAttribute("title") ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ");
        return {
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 80),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
        };
      })
      .filter((x) => x.visible && vpName === "mobile" && (x.width < 36 || x.height < 36))
      .slice(0, 40);

    return {
      viewport: vpName,
      title: document.title,
      url: location.pathname,
      scrollHeight: Math.round(doc.scrollHeight),
      viewportHeight: vh,
      scrollScreens: Number((doc.scrollHeight / vh).toFixed(2)),
      clientWidth: vw,
      scrollWidth: Math.max(body.scrollWidth, doc.scrollWidth),
      overflow,
      tinyText: textNodes,
      smallTargets: targets,
    };
  }, viewportName);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
});

const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await login(page);
  await context.storageState({ path: path.join(outDir, "storage.json") });
  await context.close();

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      storageState: path.join(outDir, "storage.json"),
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      deviceScaleFactor: 1,
    });
    const p = await ctx.newPage();
    for (const route of routes) {
      try {
        await p.goto(`${base}${route}`, { waitUntil: "load", timeout: 20000 });
      } catch (err) {
        console.error(`nav failed ${route}: ${err.message?.split("\n")[0]}`);
        continue;
      }
      // Let client-side fetches and first paint settle without waiting for SSE to go idle.
      await p.waitForTimeout(1200);
      await p.screenshot({
        path: path.join(outDir, `${vp.name}-${slug(route)}.png`),
        fullPage: true,
      });
      results.push(await analyze(p, vp.name));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(results, null, 2));
for (const result of results) {
  const problems = [
    result.scrollWidth > result.clientWidth
      ? `overflow ${result.scrollWidth}/${result.clientWidth}`
      : null,
    result.tinyText.length ? `tinyText ${result.tinyText.length}` : null,
    result.smallTargets.length ? `smallTargets ${result.smallTargets.length}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(
    `${result.viewport.padEnd(7)} ${result.url.padEnd(12)} screens=${result.scrollScreens}${problems ? `  ${problems}` : ""}`,
  );
}
console.log(`report ${path.join(outDir, "report.json")}`);
