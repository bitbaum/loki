import { NextRequest, NextResponse } from "next/server";
import { readIdParam, jsonError } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { getProjectCore } from "@/db/queries/projects";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { listProjectFeedback } from "@/db/queries/site-feedback";
import { injectPrompt } from "@/lib/inject-core";
import { appUrl } from "@/lib/email";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { fenceUntrusted, UNTRUSTED_PREAMBLE } from "@/lib/feedback/untrusted";
import { SYNTHESIZE_MIN_ITEMS } from "@/lib/feedback/compose-dispatch";
import type { FeedbackListItem } from "@/db/queries/site-feedback";

/**
 * "Synthesize": when the inbox is noisy, shift the unit of action from item to
 * theme. Dispatches an agent that clusters the NEW feedback into 2-4
 * structured briefs and files each brief back through the same public widget
 * API — so briefs land in the same inbox with the same three actions (dispatch
 * / edit-and-dispatch / archive) as any row. 9 reports of one broken button
 * become one brief with "evidence: 9 submissions". Review-only run: the
 * operator still triages; nothing auto-dispatches.
 *
 * Prefer Dispatch-all-as-one (`dispatch-batch`) when you want one fix run now
 * without a second triage gate. Synthesize when volume is high and themes help.
 */

export const SYNTHESIZER_CONTACT = "Loki synthesizer";
const MAX_ITEMS = 60;

function renderItem(f: FeedbackListItem): string {
  const times = f.duplicateCount > 1 ? ` (reported ${f.duplicateCount}×)` : "";
  const parts = [
    `- [${f.id.slice(0, 8)}]${times}`,
    fenceUntrusted("FEEDBACK", f.suggestion.replaceAll('"', "'")),
    `  page: ${f.url ?? f.page ?? "unknown"}${f.scope ? ` · scope: ${f.scope}` : ""}`,
  ];
  if (f.selectedElements?.length) {
    parts.push(`  elements: ${f.selectedElements.map((el) => el.selector).join(", ")}`);
  }
  return parts.join("\n");
}

function composeSynthesizePrompt(
  items: FeedbackListItem[],
  projectName: string,
  widgetToken: string,
): string {
  const ingestUrl = `${appUrl().replace(/\/$/, "")}/api/feedback`;
  const siteOrigin = (() => {
    const withUrl = items.find((f) => f.url);
    try {
      return withUrl?.url ? new URL(withUrl.url).origin : appUrl();
    } catch {
      return appUrl();
    }
  })();
  return [
    `Synthesize the visitor-feedback inbox of ${projectName} into structured briefs. Do NOT change any code — this is an analysis-only run; the operator dispatches fixes separately.`,
    UNTRUSTED_PREAMBLE,
    "",
    `${items.length} NEW feedback items (id-prefix, text, location):`,
    ...items.map(renderItem),
    "",
    "1. CLUSTER the items into at most 4 themes. A theme = several items pointing at the same underlying problem (same element, same page area, same class of defect). Items that fit no theme and matter on their own stay un-clustered — skip them, they already have their own row.",
    "2. For each theme, WRITE one brief, exactly this shape:",
    "   BRIEF: <one-line theme>",
    "   EVIDENCE: <N> submissions (<comma-separated id-prefixes>)",
    "   PROPOSED CHANGE: <the concrete change that addresses all of them>",
    "   WHERE: <pages/selectors affected>",
    "3. FILE each brief as ONE submission (this puts it in the same inbox, ready to dispatch):",
    "```",
    `curl -s -X POST ${ingestUrl} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Origin: ${siteOrigin}" \\`,
    `  -d '{"token":"${widgetToken}","suggestion":"<the four BRIEF lines as one string, newline-separated, <=2000 chars>","contact":"${SYNTHESIZER_CONTACT}","source":"${FEEDBACK_SOURCE.SYNTHESIZER}","scope":"site","intent":"note","page":"<most-affected pathname or />"}'`,
    "```",
    "Verify each POST returns ok:true.",
    "4. HANDOFF: one line per filed brief (theme + evidence count) and how many items stayed un-clustered. If nothing clusters, file nothing and say so.",
  ].join("\n");
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return jsonError("Project not found", 404);
  const token = await getActiveWidgetToken(userId, idOrResp);
  if (!token)
    return jsonError(
      "Enable the feedback widget first — briefs are filed through the widget API",
      400,
    );

  // Briefs (source=synthesizer) are this agent's own output — re-synthesizing
  // them would compound aggregates. The contact check keeps legacy rows out.
  const items = (await listProjectFeedback(userId, idOrResp))
    .filter(
      (f) =>
        f.status === FEEDBACK_STATUS.NEW &&
        f.source !== FEEDBACK_SOURCE.SYNTHESIZER &&
        f.contact !== SYNTHESIZER_CONTACT,
    )
    .slice(0, MAX_ITEMS);
  if (items.length < SYNTHESIZE_MIN_ITEMS) {
    return jsonError(
      `Nothing to synthesize — needs at least ${SYNTHESIZE_MIN_ITEMS} new items`,
      400,
    );
  }

  const { status, body } = await injectPrompt(
    {
      tab: project.name,
      customPrompt: composeSynthesizePrompt(items, project.name, token.token),
      notifyOnClose: true,
    },
    userId,
  );
  return NextResponse.json(body, { status });
}
