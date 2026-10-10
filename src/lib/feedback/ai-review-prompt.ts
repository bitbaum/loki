import { appUrl } from "@/lib/email";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";

/**
 * The prompt that has an agent read a live page and file what it finds as
 * visitor feedback — through the same public widget API a person uses, so
 * the findings land in the same inbox under the same triage. Review never
 * changes code; the operator (or the autopilot night) decides what to build.
 *
 * One prompt, two callers: "AI review this page" on a project, and the
 * autopilot night's site read. They must not drift.
 */
const AI_REVIEWER_CONTACT = "Loki AI reviewer";

export function composeReviewPrompt(
  pageUrl: string,
  projectName: string,
  widgetToken: string,
): string {
  const ingestUrl = `${appUrl().replace(/\/$/, "")}/api/feedback`;
  // The ingest route enforces the token's origins allowlist against the Origin
  // header; curl sends none by default, so the reviewer must claim the page's
  // own origin — the same one a browser widget on that page would send.
  const pageOrigin = new URL(pageUrl).origin;
  return [
    `Review this live page of ${projectName} the way a demanding visitor would, then file each finding as visitor feedback. Do NOT change any code — this is a review-only run; the operator triages and dispatches fixes separately.`,
    "",
    `PAGE: ${pageUrl}`,
    "",
    "1. SEE the page. Write a throwaway Playwright script (headless chromium; playwright is a devDependency of Loki — `npx playwright install chromium` if browsers are missing) that opens the page at desktop 1440x900 AND mobile 320x800 viewports, waits for network idle, saves a full-page screenshot per viewport, and captures console errors + failed network requests. Read the screenshots with your own eyes. If no headless browser can run in this environment, fall back to `curl` + static HTML review and say so in a finding.",
    "2. JUDGE: broken layout or horizontal overflow (especially at 320px), unreadable contrast, console errors, broken links/images, confusing or wrong copy, missing empty/loading states, anything a real visitor would trip over. Concrete defects only — no generic advice.",
    "3. FILE each finding (max 8, worst first) as its own submission:",
    "```",
    `curl -s -X POST ${ingestUrl} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Origin: ${pageOrigin}" \\`,
    `  -d '{"token":"${widgetToken}","suggestion":"<one concrete issue + where + why it matters, <=2000 chars>","contact":"${AI_REVIEWER_CONTACT}","source":"${FEEDBACK_SOURCE.AI_REVIEW}","page":"<pathname>","url":"${pageUrl}","pageTitle":"<title>","scope":"element","selectedElements":[{"elementType":"<tag>","elementText":"<visible text, <=100 chars>","selector":"<real CSS selector from the live DOM>"}]}'`,
    "```",
    `Use scope "page" (and omit selectedElements) only when an issue has no single element. Verify each POST returns ok:true.`,
    `SHOW what you saw: on the FIRST finding (and on any finding about layout), add "screenshots":["<data URL>"] — the mobile screenshot of the viewport where the issue is, as JPEG at quality 60 and at most 390px wide (resize with Playwright's screenshot clip or sharp; one data URL must stay under 600000 characters). The owner reads your findings beside the picture you read them from; a finding with no picture is a claim they have to go and check.`,
    "4. HANDOFF: end with a one-line summary per filed finding and the count submitted. If the page is genuinely clean, file nothing and say so.",
  ].join("\n");
}
