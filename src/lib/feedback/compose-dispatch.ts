/**
 * Prompt composition for feedback → agent dispatch.
 * SSOT so single-row Implement and batch "Implement all as one" stay aligned.
 */
import type { FeedbackCaptureContext } from "../../../widget/capture-context";
import { fenceUntrusted, inlineUntrusted, UNTRUSTED_PREAMBLE } from "@/lib/feedback/untrusted";
import { fixNoteInstruction } from "@/lib/feedback/fix-note";
import { momentClock, type ReportMoment } from "../../../widget/moments-contract";

export type FeedbackPromptFields = {
  suggestion: string;
  captureContext?: FeedbackCaptureContext | null;
  duplicateCount: number;
  url: string | null;
  page: string | null;
  scope: string | null;
  selectedElements: Array<{ elementType: string; elementText: string; selector: string }> | null;
  /** `owner` = the project's owner, proven by their pass: a request to build,
   *  not a stranger's report. Still fenced as text from a browser. */
  source?: string | null;
  /** What was seen while each thing was said (widget/moments-contract.ts). */
  moments?: ReportMoment[] | null;
  /** Built for the person who asked: it goes live on their word only. */
  previewFirst?: boolean | null;
};

/**
 * The reporter's walk through the page, one line per moment: when, where,
 * what was on screen, what they tapped, what they said. Text a stranger wrote
 * and a page they were on — fenced, never instructions.
 */
export function renderMoments(moments: ReportMoment[] | null | undefined): string[] {
  if (!moments?.length) return [];
  const lines = moments.map((m) => {
    const parts = [
      `${momentClock(m.at)} on ${inlineUntrusted(m.page, 300)} — “${inlineUntrusted(m.label, 80)}”${m.marked ? " (marked)" : ""}`,
    ];
    if (m.scrollY !== undefined) parts.push(`scrolled ${m.scrollY}px`);
    if (m.tap)
      parts.push(
        `tapped “${inlineUntrusted(m.tap.text, 80)}” (${inlineUntrusted(m.tap.selector, 500)})`,
      );
    if (m.text) parts.push(`on screen: “${inlineUntrusted(m.text, 160)}”`);
    if (m.said) parts.push(`said: “${inlineUntrusted(m.said, 600)}”`);
    return `- ${parts.join("; ")}`;
  });
  return [
    "What they saw while saying it, in order (each line: when, the part of the page in view, what they tapped, what was on screen, what they said):",
    fenceUntrusted("WALK", lines.join("\n")),
  ];
}

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
  "Implement includes shipping: use this repository’s normal PR/merge/deploy path. Your job ends at a green pull request — finish with `status: ready`, the PR URL and the commit; do not wait for the merge and do not merge it yourself. Loki follows that PR to merged and deployed and tells the operator when it is their turn, so an open PR is honest progress, not a finished fix. State what to verify at the reported live URL once it deploys. Only report a blocker when the PR could not be opened or its checks are red; a local edit or a finished agent session is not a live fix. Leave feedback resolution to the operator. Your last steps, in order, every run: `git add -A && git commit` on the branch you are on, `git push -u origin HEAD`, then `gh pr create --fill` (draft if told to) and print the PR URL — uncommitted work is lost when the session ends.";

/** A client's change goes live on the client's word only (lib/feedback/auto-ship.ts).
 *  A draft is what keeps every merge bot — the repository's own too — off it. */
const CLIENT_SHIP_INSTRUCTION =
  'This change was asked for by the site\'s client, and they decide when it goes live: if you open a pull request, open it as a DRAFT (`gh pr create --draft`) and never mark it ready or merge it. Loki lifts it when the client says "Make it live".';

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
  /**
   * The ask as the OWNER put it, after reading Loki's read of the report
   * (lib/feedback/read-report) and editing it. When present it is the
   * instruction; the report below is the context it came from. This is what
   * lets a collaborator's feedback be built without being built verbatim.
   */
  ask?: string,
): string {
  const times = feedback.duplicateCount > 1 ? ` (reported ${feedback.duplicateCount}×)` : "";
  const heading = ask
    ? `The owner of ${projectName} read this report and decided what to change. Do exactly what THE ASK says; the report is the context it came from.`
    : feedback.source === "owner"
      ? `The owner of ${projectName} asked for this change while looking at their live site. Make it.`
      : feedback.source === "client"
        ? `The client of ${projectName} — the person the site is for — asked for this change. Make it.`
        : `Fix this visitor feedback on ${projectName}.${times}`;
  const lines = [
    heading,
    UNTRUSTED_PREAMBLE,
    "",
    ...(ask ? [`THE ASK: ${ask}`, ""] : []),
    ...(note ? [`OPERATOR INSTRUCTION: ${note}`, ""] : []),
    fenceUntrusted("FEEDBACK", feedback.suggestion),
    `Page: ${inlineUntrusted(feedback.url ?? feedback.page ?? "unknown", 1000)}`,
  ];
  if (feedback.scope) lines.push(`Scope the visitor selected: ${feedback.scope}`);
  lines.push(...renderElements(feedback));
  lines.push(...renderMoments(feedback.moments));
  if (feedback.captureContext)
    lines.push(
      fenceUntrusted("PAGE CONTEXT WHEN COMMENTING", JSON.stringify(feedback.captureContext)),
    );
  lines.push(
    "",
    "Scope: address exactly this feedback — no unrelated refactors.",
    SHIP_INSTRUCTION,
    ...(feedback.previewFirst ? [CLIENT_SHIP_INSTRUCTION] : []),
    fixNoteInstruction(),
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
    fixNoteInstruction(),
    "",
  ];
  items.forEach((f, i) => {
    const times = f.duplicateCount > 1 ? ` (reported ${f.duplicateCount}×)` : "";
    lines.push(`### ${i + 1}/${items.length}${times}`);
    lines.push(fenceUntrusted("FEEDBACK", f.suggestion));
    lines.push(`Page: ${inlineUntrusted(f.url ?? f.page ?? "unknown", 1000)}`);
    if (f.scope) lines.push(`Scope: ${f.scope}`);
    lines.push(...renderElements(f));
    lines.push(...renderMoments(f.moments));
    if (f.captureContext)
      lines.push(fenceUntrusted("PAGE CONTEXT WHEN COMMENTING", JSON.stringify(f.captureContext)));
    lines.push("");
  });
  return lines.join("\n");
}

/** Minimum NEW visitor items before Synthesize (theme briefs) is useful. */
export const SYNTHESIZE_MIN_ITEMS = 3;
