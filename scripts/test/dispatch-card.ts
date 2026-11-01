/**
 * The card under a Loki dispatch: one headline, one next step.
 * Case from the report (2026-10-05): queued for this computer, Fleet Runner
 * offline — the card offered Control state / Cloud terminal / This computer.
 */
import { isDispatchCardAction, presentDispatchCard, terminalHref } from "@/lib/dispatch-card";

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
  detail: "waiting for a runner to pick it up",
  tone: "neutral" as const,
};

const waitingLocal = { ...base, live: queued, warn: true, channel: "local" as const };

const reported = presentDispatchCard({ ...waitingLocal, cloud: "private" });
check("names the runner it waits for", reported.headline === "Waiting for this computer");
check(
  "with a private cloud, the next step is connecting Fleet Runner",
  !isDispatchCardAction(reported.primary) && reported.primary?.href === "/download",
);
check(
  "no cloud terminal for local work",
  !reported.secondary.some((l) => l.href.includes("terminal")),
);
check("says nothing is lost", /stays queued/.test(reported.detail ?? ""));

// 2026-10-12: the owner on a second computer. The account has the cloud
// builder and it is online; the card offered a download instead.
const owner = presentDispatchCard({ ...waitingLocal, cloud: "online" });
check(
  "with the cloud online, the next step is running it there",
  isDispatchCardAction(owner.primary) && owner.primary.action === "run-in-cloud",
);
check(
  "…and no link to the download anywhere on the card",
  !owner.secondary.some((l) => l.href === "/download"),
);
check("…and it says nothing needs installing", /nothing to install/.test(owner.detail ?? ""));

const cloudDown = presentDispatchCard({ ...waitingLocal, cloud: "offline" });
check(
  "cloud down for an account that has it: Control, not a download",
  !isDispatchCardAction(cloudDown.primary) && cloudDown.primary?.href === "/control?focus=loki",
);
check(
  "…and it names both runners as offline",
  /cloud runner is offline too/.test(cloudDown.detail ?? ""),
);
check("…with no download at all", !cloudDown.secondary.some((l) => l.href === "/download"));

const unknown = presentDispatchCard(waitingLocal);
check(
  "before presence is known, the download is a quiet secondary, never the primary",
  !isDispatchCardAction(unknown.primary) &&
    unknown.primary?.href === "/control?focus=loki" &&
    unknown.secondary.some((l) => l.href === "/download"),
);

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
check(
  "…as the agent's conversation, on the machine it runs on",
  !isDispatchCardAction(running.primary) &&
    running.primary?.href === "/terminal?source=machine&tab=loki&view=chat",
);
check(
  "cloud work opens the cloud terminal",
  terminalHref("loki", "cloud") === "/terminal?project=loki",
);

const failed = presentDispatchCard({ ...base, failed: true });
check(
  "a failure goes to Control",
  !isDispatchCardAction(failed.primary) &&
    failed.primary?.href === "/control?focus=loki" &&
    failed.tone === "negative",
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
  many.secondary.some((l) => l.label === "All 3 on Home"),
);

check("no project, no links", presentDispatchCard({ ...base, project: null }).primary === null);

console.log(`\n${passed}/${passed} dispatch-card cases passed`);
