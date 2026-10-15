/** Downloadable, review-scoped browser worker. Never accepts shell/page actions from the server. */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import type { Browser, Request } from "playwright";
import {
  reviewUrl,
  type ReviewFrame,
  type ReviewWorkerEvent,
  type ReviewStatus,
} from "../src/lib/inspection/contract";
import { isPrivateAddress } from "../src/lib/private-address";

type Config = { endpoint: string; token: string; workerId?: string };
type Reply = {
  status: ReviewStatus;
  accepted: boolean;
  mode: string;
  url: string;
  paths: string[];
  limits: { pages: number; scrolls: number; findings: number; lifetimeMs: number };
};
export class ReviewStopped extends Error {}
export async function reviewRequestAllowed(
  request: Pick<Request, "url" | "method" | "isNavigationRequest">,
  origin: string,
  lookupHost = lookup,
): Promise<boolean> {
  try {
    const url = new URL(request.url());
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !["", "80", "443"].includes(url.port)
    )
      return false;
    if (!["GET", "HEAD"].includes(request.method())) return false;
    if (request.isNavigationRequest() && !reviewUrl(url.href, origin)) return false;
    const addresses = await lookupHost(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
    return !!addresses.length && addresses.every((answer) => !isPrivateAddress(answer.address));
  } catch {
    return false;
  }
}
export async function runInspection(configPath: string, requestAllowed = reviewRequestAllowed) {
  const config: Config = JSON.parse(await readFile(configPath, "utf8"));
  config.workerId ??= randomUUID();
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const send = async (event: ReviewWorkerEvent): Promise<Reply> => {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        "X-Review-Worker": config.workerId!,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Review connection failed (${response.status})`);
    return response.json();
  };
  const started = Date.now();
  const checkpoint = async (): Promise<Reply> => {
    for (;;) {
      const reply = await send({ kind: "checkpoint", workerId: config.workerId! });
      if (!reply.accepted || ["stopped", "finished", "failed"].includes(reply.status))
        throw new ReviewStopped("Review ended");
      if (Date.now() - started > reply.limits.lifetimeMs)
        throw new Error("Review time limit reached");
      if (reply.status !== "paused") return reply;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };
  const plan = await checkpoint();
  if (plan.mode === "code") {
    await send({
      kind: "message",
      text: "Browser inspection was not selected. The engineer will now review the project's code and record file-level evidence.",
    });
    return;
  }
  let browser: Browser | undefined;
  let findings = 0;
  try {
    const require = createRequire(`${process.cwd()}/package.json`);
    const loaded = await import(pathToFileURL(require.resolve("playwright")).href);
    const { chromium } = (loaded.default ?? loaded) as typeof import("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    // Resolve every host before each request, including redirects and subresources.
    // Like the existing site consultation guard, DNS rebinding remains a platform limitation.
    await context.route("**/*", async (route) => {
      if (await requestAllowed(route.request(), plan.url)) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.addInitScript(() => {
      // Show where the reviewer navigates without modifying the site's application state.
      const style = document.createElement("style");
      style.textContent = "html{scroll-behavior:auto!important}";
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style), {
        once: true,
      });
    });
    const queue = [
      ...new Set([
        plan.url,
        ...plan.paths.map((p) => reviewUrl(p, plan.url)).filter((p): p is string => !!p),
      ]),
    ];
    const visited = new Set<string>();
    const recordFinding = async (
      title: string,
      detail: string,
      evidence: string,
      location: string,
    ) => {
      if (findings >= plan.limits.findings) return;
      await checkpoint();
      await send({
        kind: "finding",
        finding: { title, detail, evidence, location, category: "functional" },
      });
      findings++;
    };
    const frame = async (action: string, analyze: boolean) => {
      await checkpoint();
      const viewport = page.viewportSize()!;
      const image = (
        await page.screenshot({ type: "jpeg", quality: 48, animations: "disabled", timeout: 10000 })
      ).toString("base64");
      const data: ReviewFrame = {
        url: page.url(),
        image: `data:image/jpeg;base64,${image}`,
        width: viewport.width,
        height: viewport.height,
        scrollY: await page.evaluate(() => window.scrollY),
        action,
      };
      await send({ kind: "frame", frame: data, text: action, analyze });
      // A deliberate viewing interval, interruptible on the next checkpoint.
      for (let i = 0; i < 2; i++) {
        await checkpoint();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };
    for (let index = 0; index < queue.length && visited.size < plan.limits.pages; index++) {
      const url = reviewUrl(queue[index]!, plan.url);
      if (!url || visited.has(url)) continue;
      visited.add(url);
      for (const width of [390, 1440]) {
        await checkpoint();
        await page.setViewportSize({ width, height: width === 390 ? 760 : 900 });
        const errors: string[] = [];
        const onError = (error: Error) => {
          if (errors.length < 8) errors.push(error.message.slice(0, 250));
        };
        page.on("pageerror", onError);
        try {
          // Use a visible link where it exists; otherwise open the discovered route directly.
          const link = page.locator("a[href]").filter({ visible: true });
          let clicked = false;
          for (const candidate of (await link.all()).slice(0, 100)) {
            if (
              reviewUrl((await candidate.getAttribute("href")) ?? "", page.url()) === url &&
              page.url() !== "about:blank"
            ) {
              await checkpoint();
              await candidate.evaluate((el) => {
                (el as HTMLElement).style.outline = "3px solid #ff5c00";
                el.scrollIntoView({ block: "center" });
              });
              await frame(
                `Following ${(await candidate.innerText().then((t) => t.slice(0, 70))) || "a page link"}`,
                false,
              );
              await checkpoint();
              await candidate.click({ timeout: 5000, noWaitAfter: true });
              await page.waitForURL(url, { timeout: 12000 });
              clicked = true;
              break;
            }
          }
          const response = clicked
            ? null
            : await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(700);
          if (!reviewUrl(page.url(), plan.url))
            throw new Error("The page redirected outside the review site");
          if (response && response.status() >= 400)
            await recordFinding(
              `Page returned ${response.status()}`,
              "Visitors cannot open this page normally.",
              `HTTP ${response.status()} at ${width}px`,
              url,
            );
          await frame(
            `Checking ${new URL(url).pathname} on ${width === 390 ? "phone" : "desktop"}`,
            true,
          );
          const links = await page
            .locator("a[href]")
            .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href));
          for (const href of links) {
            const next = reviewUrl(href, plan.url);
            if (next && !queue.includes(next) && queue.length < plan.limits.pages * 4)
              queue.push(next);
          }
          const size = await page.evaluate(() => ({
            height: document.documentElement.scrollHeight,
            overflow: document.documentElement.scrollWidth > innerWidth + 2,
            signIn: /\/(login|signin|sign-in|auth)(\/|\?|$)/i.test(location.pathname),
          }));
          if (size.overflow)
            await recordFinding(
              "The page scrolls sideways",
              "The layout extends beyond the screen, making content harder to read and controls harder to reach.",
              `document width exceeds ${width}px viewport`,
              url,
            );
          let bottom = 0;
          for (
            let scroll = 1;
            scroll < plan.limits.scrolls && bottom + page.viewportSize()!.height < size.height;
            scroll++
          ) {
            await checkpoint();
            bottom = Math.min(
              size.height - page.viewportSize()!.height,
              scroll * (page.viewportSize()!.height - 100),
            );
            await page.evaluate((y) => window.scrollTo(0, y), bottom);
            await frame(
              `Reading further down ${new URL(url).pathname}`,
              plan.mode !== "functional",
            );
          }
          if (errors.length)
            await recordFinding(
              "A page error interrupted the app",
              "The browser reported an application error on this page.",
              errors.join("\n"),
              url,
            );
          await send({
            kind: "page",
            url,
            width,
            result: size.signIn ? "blocked" : "visited",
            detail: size.signIn
              ? "Sign-in required. Private pages and flows were not inspected."
              : `Navigation and ${Math.min(size.height, bottom + page.viewportSize()!.height)} of ${size.height}px viewed. Forms, purchases and other changes were not submitted.`,
          });
        } catch (error) {
          if (error instanceof ReviewStopped) throw error;
          await checkpoint();
          const detail =
            error instanceof Error ? error.message.slice(0, 900) : "Could not open this page";
          await send({ kind: "page", url, width, result: "failed", detail });
          await recordFinding(
            "This page could not be reviewed",
            "The browser could not finish loading or navigating this page.",
            detail,
            url,
          );
        } finally {
          page.off("pageerror", onError);
        }
      }
    }
    await checkpoint();
    const summary = `Browser review visited ${visited.size} distinct URLs. ${queue.length > visited.size ? `${queue.length - visited.size} discovered URLs remain outside this review's ${plan.limits.pages}-page limit. ` : ""}Unlinked routes, signed-in flows and actions that change data remain untested. Screenshots are sampled viewports, not proof that every interaction works.`;
    await send({
      kind: plan.mode === "full" ? "message" : "finished",
      text: summary + (plan.mode === "full" ? " Code review is next." : ""),
    });
  } catch (error) {
    if (error instanceof ReviewStopped) return;
    await send({
      kind: "failed",
      text: `Browser review stopped: ${error instanceof Error ? error.message.slice(0, 800) : "unknown error"}. Coverage is incomplete.`,
    }).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInspection(process.argv[2] ?? "").catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
