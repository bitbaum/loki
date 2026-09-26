/**
 * Prompt composition for feedback → agent dispatch.
 * SSOT so single-row Implement and batch "Implement all as one" stay aligned.
 */
import { fenceUntrusted, inlineUntrusted, UNTRUSTED_PREAMBLE } from "@/lib/feedback/untrusted";

export type FeedbackPromptFields = {
  suggestion: string;
  duplicateCount: number;
  url: string | null;
  page: string | null;
  scope: string | null;
  selectedElements: Array<{ elementType: string; elementText: string; selector: string }> | null;
  /** `owner` = the project's owner, proven by their pass: a request to build,
   *  not a stranger's report. Still fenced as text from a browser. */
  source?: string | null;
};

// "Shipped" must include a PR handed to auto-merge. Told only "shipping is
// blocked → report the blocker", agents opened their PR, honestly wrote
// `status: working` because they may not merge their own work, and the run
// never closed: the inbox read "Working now" for an hour until the reaper
// stamped it (velokiosk-sep10 and kaffeeklappe-sep11, 2026-09-11).
//
// This comment used to claim "every site Loki registers carries ci.yml +
// auto-merge.yml, so a green PR ships itself". It does not: site provisioning
// writes deploy.yml and nothing else (src/lib/site-cd.ts). Two green agent PRs
// sat open on dogfood-site-sep10-1201 for a day because of it, and the
// instruction below told the agent that was "shipped".
//
// The agent's job still ends at the PR — it may not merge its own work, and
// waiting for a merge is what kept runs open for an hour. What changed is that
// the PR is no longer where Loki stops looking: the fix ledger
// (src/lib/feedback/fix-shipping.ts) follows it to merged and deployed, and
// the feedback row asks the operator to merge when nothing else will.
const SHIP_INSTRUCTION =
  "Implement includes shipping: use this repository’s normal PR/merge/deploy path. Your job ends at a green pull request — finish with `status: ready`, the PR URL and the commit; do not wait for the merge and do not merge it yourself. Loki follows that PR to merged and deployed and tells the operator when it is their turn, so an open PR is honest progress, not a finished fix. State what to verify at the reported live URL once it deploys. Only report a blocker when the PR could not be opened or its checks are red; a local edit or a finished agent session is not a live fix. Leave feedback resolution to the operator.";

function renderElements(feedback: FeedbackPromptFields): string[] {
  if (!feedback.selectedElements?.length) return [];
  const lines = ["Element(s) the visitor pointed at:"];
  for (const el of feedback.selectedElements) {
    lines.push(
      `- <${inlineUntrusted(el.elementType, 100)}> ${inlineUntrusted(el.selector, 500)}${el.elementText ? ` — "${inlineUntrusted(el.elementText, 100)}"` : ""}`,
    );
  }
  return lines;
}

/** One visitor report → one scoped fix prompt. */
export function composeFeedbackFixPrompt(
  feedback: FeedbackPromptFields,
  projectName: string,
  note?: string,
): string {
  const times = feedback.duplicateCount > 1 ? ` (reported ${feedback.duplicateCount}×)` : "";
  const heading =
    feedback.source === "owner"
      ? `The owner of ${projectName} asked for this change while looking at their live site. Make it.`
      : `Fix this visitor feedback on ${projectName}.${times}`;
  const lines = [
    heading,
    UNTRUSTED_PREAMBLE,
    "",
    ...(note ? [`OPERATOR INSTRUCTION: ${note}`, ""] : []),
    fenceUntrusted("FEEDBACK", feedback.suggestion),
    `Page: ${inlineUntrusted(feedback.url ?? feedback.page ?? "unknown", 1000)}`,
  ];
  if (feedback.scope) lines.push(`Scope the visitor selected: ${feedback.scope}`);
  lines.push(...renderElements(feedback));
  lines.push(
    "",
    "Scope: address exactly this feedback — no unrelated refactors.",
    SHIP_INSTRUCTION,
  );
  return lines.join("\n");
}

/**
 * Many NEW reports → one agent run. Prefer this over N separate Dispatch clicks
 * when the captain wants a single coherent pass (shared root cause or a small
 * pile). Synthesize (theme briefs back into the inbox) is the alternative when
 * volume is high and you want another triage gate first.
 */
export function composeFeedbackBatchFixPrompt(
  items: FeedbackPromptFields[],
  projectName: string,
  note?: string,
): string {
  const lines = [
    `Fix these ${items.length} visitor-feedback items on ${projectName} in one pass.`,
    UNTRUSTED_PREAMBLE,
    "",
    ...(note ? [`OPERATOR INSTRUCTION: ${note}`, ""] : []),
    "Address every item below. Prefer one coherent change set when items share a root cause; otherwise fix them independently, most recent first.",
    "Scope: only these reports — no unrelated refactors.",
    SHIP_INSTRUCTION,
    "",
  ];
  items.forEach((f, i) => {
    const times = f.duplicateCount > 1 ? ` (reported ${f.duplicateCount}×)` : "";
    lines.push(`### ${i + 1}/${items.length}${times}`);
    lines.push(fenceUntrusted("FEEDBACK", f.suggestion));
    lines.push(`Page: ${inlineUntrusted(f.url ?? f.page ?? "unknown", 1000)}`);
    if (f.scope) lines.push(`Scope: ${f.scope}`);
    lines.push(...renderElements(f));
    lines.push("");
  });
  return lines.join("\n");
}

/** Minimum NEW visitor items before Synthesize (theme briefs) is useful. */
export const SYNTHESIZE_MIN_ITEMS = 3;
