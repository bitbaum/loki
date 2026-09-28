/** Fixture for the /feedback preview: one row per phase the page can show. */
const owner = "00000000-0000-4000-8000-000000000001";
const petvity = "5936f8fb-7239-4942-a7a9-95f77e7cc322";
const loki = "8130c927-114a-45b7-8cc2-99efd5224025";
const heidi = "11111111-1111-4111-8111-111111111111";
const substrata = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-09-28T13:50:00Z");
const ago = (m: number) => new Date(now - m * 60_000).toISOString();

function row(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    projectId: petvity,
    userId: owner,
    reporterUserId: null,
    tokenId: null,
    suggestion: "",
    contact: null,
    page: "/de",
    url: "https://petvity.orangecat.ch/de",
    pageTitle: "Petvity",
    scope: "page",
    selectedElements: null,
    userAgent: null,
    source: "visitor",
    contentHash: "x",
    duplicateCount: 1,
    featuredAt: null,
    status: "new",
    dispatchedRunId: null,
    resolvedAt: null,
    createdAt: ago(5),
    hasScreenshots: false,
    liveUrl: "https://petvity.orangecat.ch",
    runnable: true,
    projectName: "petvity",
    work: {
      phase: "not_started",
      waitingOn: "you",
      label: "Not started",
      detail: null,
      watchable: false,
    },
    ...over,
  };
}

export const FIXTURE = {
  ok: true,
  feedback: [
    row({
      suggestion:
        "Let's redo the design on this page. Let's make it look incredibly beautiful, really, really beautiful, really, really on-brand. It has to impress at the very first glance and make people want to sign up.",
      source: "owner",
      createdAt: ago(29),
      status: "dispatched",
      dispatchedRunId: "r-failed",
      work: {
        phase: "failed",
        waitingOn: "you",
        label: "Failed",
        detail: "The agent ran out of quota — switch provider, or Retry once it resets.",
        diagnostic:
          "Dispatch failed before the prompt reached the agent: claude cannot generate because its usage limit is exhausted. Switch this project to a provider with available capacity, then Retry.",
        watchable: true,
        terminalReady: false,
        runId: "r-failed",
      },
    }),
    row({
      suggestion:
        'At the very bottom of the page, add a small "Back to top" link so people on phones can get back to the menu quickly.',
      projectId: loki,
      projectName: "farmhouse",
      page: "/",
      url: "https://farmhouse.orangecat.ch/",
      liveUrl: "https://farmhouse.orangecat.ch",
      duplicateCount: 2,
      createdAt: ago(600),
      status: "dispatched",
      dispatchedRunId: "r-live",
      work: {
        phase: "needs_verify",
        waitingOn: "you",
        label: "Shipped · confirm",
        detail: null,
        checkLive: true,
        ship: {
          state: "deployed",
          pr: {
            number: 2,
            url: "https://github.com/bitbaum/farmhouse/pull/2",
            title: "Add back to top",
          },
          checkedAt: ago(3),
        },
        didLine: "Added a Back to top link in the footer.",
        runId: "r-live",
      },
    }),
    row({
      suggestion: "The hero headline wraps onto four lines on a phone; tighten it.",
      projectId: loki,
      projectName: "loki",
      page: "/",
      url: "https://loki.orangecat.ch/",
      liveUrl: "https://loki.orangecat.ch",
      source: "ai_review",
      createdAt: ago(12),
      status: "dispatched",
      dispatchedRunId: "r-working",
      work: {
        phase: "working",
        waitingOn: "machine",
        label: "Working · 9m",
        detail: null,
        watchable: true,
        terminalReady: true,
        stepSummary: "Agent generating — 2 files changed so far",
        runId: "r-working",
      },
    }),
    row({
      suggestion: "Add a dark-mode toggle to the public pages.",
      projectId: heidi,
      projectName: "Heidi",
      page: "/en",
      url: "https://heidi.orangecat.ch/en",
      liveUrl: "https://heidi.orangecat.ch",
      createdAt: ago(40),
      status: "dispatched",
      dispatchedRunId: "r-queued",
      work: {
        phase: "queued",
        waitingOn: "machine",
        label: "Queued",
        detail:
          "Retried automatically — the first attempt failed because the agent hit its usage limit.",
        watchable: true,
        terminalReady: false,
        stepSummary: "Waiting for the cloud builder to pick it up",
        runId: "r-queued",
      },
    }),
    row({
      suggestion: "Typo on the pricing page: 'recieve'.",
      projectId: substrata,
      projectName: "substrata",
      page: "/pricing",
      url: "https://substrata.orangecat.ch/pricing",
      liveUrl: "https://substrata.orangecat.ch",
      createdAt: ago(3000),
      status: "resolved",
      resolvedAt: ago(2900),
      dispatchedRunId: "r-done",
      work: { phase: "done", waitingOn: "you", label: "Done", detail: null },
    }),
    row({
      suggestion: "Make the logo bigger.",
      projectId: substrata,
      projectName: "substrata",
      createdAt: ago(5000),
      status: "archived",
      work: { phase: "archived", waitingOn: "you", label: "Archived", detail: null },
    }),
  ],
  metrics: {
    total: 74,
    open: 31,
    resolved: 36,
    resolved30d: 20,
    archived: 7,
    medianResolutionHours: 26,
  },
};

export const PROVIDERS = {
  ok: true,
  current: "claude",
  installedKnown: true,
  evidence: { channel: "cloud", observedAt: ago(2) },
  options: [
    {
      id: "claude",
      label: "Claude Code",
      usable: false,
      reason: "hit its usage limit 29 minutes ago",
      block: "spent",
    },
    {
      id: "cursor",
      label: "Cursor",
      usable: false,
      reason: "not installed",
      block: "not-installed",
    },
    { id: "codex", label: "Codex", usable: true, reason: null, block: null },
    { id: "gemini", label: "Antigravity", usable: true, reason: null, block: null },
    { id: "grok", label: "Grok", usable: true, reason: null, block: null },
  ],
  next: { id: "codex", label: "Codex", usable: true, reason: null, block: null },
};
