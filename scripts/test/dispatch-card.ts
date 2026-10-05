/**
 * The card under a Loki dispatch: one headline, one next step.
 * Case from the report (2026-10-05): queued for this computer, Fleet Runner
 * offline — the card offered Control state / Cloud terminal / This computer.
 */
import { presentDispatchCard, terminalHref } from "@/lib/dispatch-card";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const base = {
  live: null,
  staticLabel: "Dispatched",
  warn: false,
  failed: false,
  channel: null,
  project: "loki",
  projectCount: 1,
} as const;
const queued = {
  status: "queued" as const,
  label: "Queued",
  detail: "waiting for a builder to pick it up",
  tone: "neutral" as const,
};

const reported = presentDispatchCard({ ...base, live: queued, warn: true, channel: "local" });
check("names the builder it waits for", reported.headline === "Waiting for this computer");
check("the next step is connecting Fleet Runner", reported.primary?.href === "/download");
check(
  "no cloud terminal for local work",
  !reported.secondary.some((l) => l.href.includes("terminal")),
);
check("says nothing is lost", /stays queued/.test(reported.detail ?? ""));

const running = presentDispatchCard({
  ...base,
  live: {
    status: "working",
    label: "Agent is working",
    detail: "still working · 2m",
    tone: "positive",
  },
  channel: "local",
});
check("while it runs, watch it", running.primary?.label === "Watch it");
check("…on the machine it runs on", running.primary?.href === "/terminal?source=machine&tab=loki");
check(
  "cloud work opens the cloud terminal",
  terminalHref("loki", "cloud") === "/terminal?project=loki",
);

const failed = presentDispatchCard({ ...base, failed: true });
check(
  "a failure goes to Control",
  failed.primary?.href === "/control?focus=loki" && failed.tone === "negative",
);

const done = presentDispatchCard({
  ...base,
  live: {
    status: "completed",
    label: "Completed",
    detail: "successful outcome recorded",
    tone: "positive",
  },
});
check("a finished run shows its result", done.primary?.label === "See the result");

const many = presentDispatchCard({ ...base, projectCount: 3 });
check(
  "a fan-out links to all of them",
  many.secondary.some((l) => l.label === "All 3 in Control"),
);

check("no project, no links", presentDispatchCard({ ...base, project: null }).primary === null);

console.log(`\n${passed}/${passed} dispatch-card cases passed`);
