// Pure tests for what a REPORTER is told about their own report.
//
// Two jobs, and the second is a privacy boundary rather than a preference:
//
//  1. Honesty. /my-feedback used to map the four DB statuses through a
//     dictionary, so `dispatched` read "Being implemented" whether an agent was
//     mid-run, had crashed days earlier, or had already shipped. work-phase.ts
//     exists because DB status cannot answer that question; this pins that the
//     reporter page now asks the phase layer instead.
//
//  2. Containment. FeedbackWorkView is written for the person who owns the
//     machine — builder asks, raw agent errors, run ids, run-hop narration.
//     None of it may reach a stranger who clicked a widget on a customer site.
//     reporter-view.ts writes its own sentences for exactly this reason, and
//     the leak test below fails if it ever starts forwarding one instead.
//
//  3. Drift. The three-line clamp shipped to the operator row in #783 — in
//     answer to a report filed FROM the reporter page — and never reached the
//     reporter page, which went on rendering that very report at full height.
//     The static pin at the bottom is what makes the next such fix impossible
//     to land on one surface only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reporterStatusFor,
  reporterToneClass,
  type ReporterTone,
} from "../../src/lib/feedback/reporter-view";
import {
  deriveFeedbackWork,
  FEEDBACK_WORK_PHASE,
  type FeedbackWorkView,
  type FeedbackRunSnapshot,
} from "../../src/lib/feedback/work-phase";
import { FEEDBACK_STATUS } from "../../src/lib/constants/statuses";
import { FIX_SHIP_STATE } from "../../src/lib/feedback/fix-shipping";
import { ORCH_STATE, ORCHESTRATION_OUTCOME } from "../../src/lib/orchestration/contract";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function view(over: Partial<FeedbackWorkView>): FeedbackWorkView {
  return {
    phase: FEEDBACK_WORK_PHASE.NOT_STARTED,
    waitingOn: "you",
    label: "Not started",
    detail: null,
    ...over,
  } as FeedbackWorkView;
}

// ---------------------------------------------------------------- exhaustive

// Every phase produces a chip, a tone and a sentence. A new phase added to
// work-phase.ts without a reporter sentence fails the switch's type check; this
// pins that none of them is a blank string at runtime either.
for (const phase of Object.values(FEEDBACK_WORK_PHASE)) {
  const s = reporterStatusFor(view({ phase }));
  assert.ok(s.label.trim().length > 0, `${phase}: empty label`);
  assert.ok(s.detail.trim().length > 0, `${phase}: empty detail`);
  assert.ok(
    reporterToneClass(s.tone).startsWith("ui-tag-"),
    `${phase}: tone ${s.tone} has no ui-tag class`,
  );
  // "dispatched" is a database word. It is never shown to anyone.
  assert.ok(
    !/dispatch/i.test(`${s.label} ${s.detail}`),
    `${phase}: leaked the DB verb into reporter copy`,
  );
}

// Every tone maps to a real variant defined in globals.css — a tone whose class
// does not exist renders an unstyled chip, which is how status stopped carrying
// signal on this page in the first place.
const css = readFileSync(join(REPO, "src", "app", "globals.css"), "utf8");
for (const tone of ["neutral", "accent", "warning", "positive"] satisfies ReporterTone[]) {
  const cls = reporterToneClass(tone);
  assert.ok(css.includes(`.${cls}`), `${cls} is not defined in globals.css`);
}

// ------------------------------------------------------------------- honesty

// THE regression. A dispatched report whose run never materialised is Stalled —
// the phase layer calls it STUCK — and the reporter is told so, instead of
// watching "Being implemented" forever.
{
  const work = deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, null);
  assert.equal(work.phase, FEEDBACK_WORK_PHASE.STUCK);
  const s = reporterStatusFor(work);
  assert.equal(s.label, "Stalled");
  assert.equal(s.tone, "warning");
  assert.notEqual(s.label, "Being implemented");
}

// A run that closed well but whose change is still an open pull request has NOT
// shipped. Telling the reporter to go look would send them to unchanged code —
// the closed-loop lie work-phase.ts was built to prevent.
{
  const snap: FeedbackRunSnapshot = {
    id: "run-1",
    state: ORCH_STATE.DONE,
    outcome: ORCHESTRATION_OUTCOME.SUCCESS,
    startedAt: new Date(Date.now() - 600_000),
    finishedAt: new Date(Date.now() - 60_000),
    deliveredAt: null,
    lastProgressAt: null,
    error: null,
    fix: { state: FIX_SHIP_STATE.PR_OPEN, checkedAt: new Date().toISOString() },
  };
  const s = reporterStatusFor(deriveFeedbackWork(FEEDBACK_STATUS.DISPATCHED, snap), {
    liveHref: "https://example.com/pricing",
  });
  assert.equal(s.action, null, "offered Check the live page before the fix shipped");
  assert.ok(!/live/i.test(s.label), `claimed live while the PR was open: ${s.label}`);
}

// Deployed — now the reporter is the right person to confirm it, and gets the
// link. This is the whole point of giving them a next action.
{
  const shipped = view({ phase: FEEDBACK_WORK_PHASE.NEEDS_VERIFY, checkLive: true });
  const s = reporterStatusFor(shipped, { liveHref: "https://example.com/pricing" });
  assert.equal(s.tone, "positive");
  assert.equal(s.action?.href, "https://example.com/pricing");
}

// No live URL to send them to = no action. An action with nowhere to go is the
// dead end this page already had too many of.
{
  const s = reporterStatusFor(view({ phase: FEEDBACK_WORK_PHASE.DONE }), { liveHref: null });
  assert.equal(s.action, null);
}

// ----------------------------------------------------------------- no leaks

// A work view stuffed with every operator-only field. None of it may appear in
// the reporter's output, for any phase — not the builder ask, not the agent's
// raw error, not the run id, not the hop narration.
{
  const SECRETS = [
    "Open Fleet Runner on This computer",
    "ECONNREFUSED at /opt/loki/agent.ts:214",
    "run-9f3a-secret",
    "cmd-7781",
    "agent is generating (hop 4)",
    "queued behind truthseeker",
  ];
  for (const phase of Object.values(FEEDBACK_WORK_PHASE)) {
    const s = reporterStatusFor(
      view({
        phase,
        detail: SECRETS[0],
        diagnostic: SECRETS[1],
        runId: SECRETS[2],
        commandId: SECRETS[3],
        stepSummary: SECRETS[4],
        queueReason: SECRETS[5],
        label: "dispatched",
      }),
    );
    const rendered = `${s.label} ${s.detail} ${s.action?.label ?? ""} ${s.action?.href ?? ""}`;
    for (const secret of SECRETS) {
      assert.ok(
        !rendered.includes(secret),
        `${phase} leaked an operator-only string to the reporter: ${secret}`,
      );
    }
  }
}

// --------------------------------------------------------------- drift guard

// The reporter page must render report bodies through the SHARED clamp, not its
// own markup. This is the pin that #783 needed and did not have.
{
  const page = readFileSync(join(REPO, "src", "app", "(app)", "my-feedback", "page.tsx"), "utf8");
  assert.ok(
    page.includes("FeedbackReportText"),
    "the reporter page stopped using the shared clamped body — one long report will own the list again",
  );
  // A raw {suggestion} paragraph is exactly what the clamp replaced.
  assert.ok(
    !/<p[^>]*>\{[^}]*\.suggestion\}/.test(page),
    "the reporter page renders a report body directly again instead of through FeedbackReportText",
  );
  // Server-side toLocaleString formats in the BOX's locale and time zone, which
  // is how a Swiss reporter was shown a US date two hours off.
  assert.ok(
    !/toLocale(String|DateString|TimeString)\(/.test(page),
    "the reporter page formats a date on the server again — use <ReportedTime>",
  );
}

console.log("feedback-reporter-view: ok");
