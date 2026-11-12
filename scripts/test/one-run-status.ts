/**
 * One status for an open run: the status fields and the delivery track are
 * read from the same facts.
 *
 * Production, 2026-11-12: /api/orchestration/runs/<id> and
 * /api/control/commands/<id> answered status "delivered" / "working" while
 * track.summary, in the same response, said "Waiting for a runner to pick it
 * up". The run route also treated every run as executed and verified from the
 * moment it was opened.
 *
 * Run: npx tsx scripts/test/one-run-status.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  alignLiveViewWithTrack,
  deriveDispatchLiveStatus,
  type DispatchLiveView,
} from "@/lib/dispatch-status";
import { buildRunTrack, type RunTrackInput } from "@/lib/run-track";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const AT = "2026-11-12T03:50:00Z";
const queuedRun: RunTrackInput = {
  eventKinds: ["dispatched"],
  eventTimes: { dispatched: AT },
  run: { startedAt: AT, finishedAt: null, outcome: null },
  askedAt: AT,
  phase: "queued",
  stalled: false,
  lastProgressAt: null,
  needsYou: null,
  builderLabel: null,
  evidence: null,
  fix: null,
  liveUrl: "https://loki.orangecat.ch",
  providerLabel: "Claude Code",
  failure: null,
};
const withEvents = (kinds: RunTrackInput["eventKinds"], over: Partial<RunTrackInput> = {}) =>
  buildRunTrack({
    ...queuedRun,
    eventKinds: kinds,
    eventTimes: Object.fromEntries(kinds.map((k) => [k, AT])),
    ...over,
  });

/** What the routes computed before: the word from the command row alone. */
const fromCommand = (cmd: { claimed?: boolean; executed?: boolean }, state = "waiting") =>
  deriveDispatchLiveStatus({
    claimedAt: cmd.claimed ? AT : null,
    executedAt: cmd.executed ? AT : null,
    result: cmd.executed ? { ok: true, verified: true } : null,
    run: { state, outcome: null, payload: null },
  });

check("the track names the status of an open run from its own facts", () => {
  assert(withEvents(["dispatched"]).live === "queued", "nobody claimed it");
  assert(withEvents(["dispatched", "claimed"]).live === "starting", "claimed");
  assert(
    withEvents(["dispatched", "claimed", "launched", "submitted"]).live === "starting",
    "submitted is not yet output",
  );
  assert(
    withEvents(["dispatched", "claimed", "submitted", "generating"], { phase: "working" }).live ===
      "working",
    "generating",
  );
  assert(
    withEvents(["dispatched"], { stalled: true }).live === "needs_you",
    "stalled in the queue",
  );
});

check("a finished run has no live status: its outcome speaks", () => {
  const done = buildRunTrack({
    ...queuedRun,
    eventKinds: ["dispatched", "claimed", "generating"],
    eventTimes: { dispatched: AT, claimed: AT, generating: AT },
    run: { startedAt: AT, finishedAt: "2026-11-12T03:58:00Z", outcome: "success" },
    phase: "done",
  });
  assert(done.live === null, `live=${done.live}`);
});

check("the incident: 'delivered' beside 'Waiting for a runner' becomes Queued", () => {
  const track = withEvents(["dispatched"]);
  assert(/Waiting for a runner/.test(track.summary), track.summary);
  // The run route's old input: executed and verified from the start.
  const before = fromCommand({ executed: true });
  assert(before.status === "delivered", `fixture drifted: ${before.status}`);
  const after = alignLiveViewWithTrack(before, track);
  assert(after.status === "queued" && after.label === "Queued", `${after.status}/${after.label}`);
  assert(after.detail === track.summary, "the detail is not the track's sentence");
  assert(after.terminal === false, "an open run was settled");
});

check("the incident: 'working' on a claim alone becomes Starting", () => {
  const track = withEvents(["dispatched", "claimed"]);
  const before = fromCommand({ claimed: true });
  assert(before.status === "working", `fixture drifted: ${before.status}`);
  const after = alignLiveViewWithTrack(before, track);
  assert(after.status === "starting" && after.label === "Starting", `${after.status}`);
  assert(after.detail === track.summary, "the detail is not the track's sentence");
});

check(
  "an open run is never 'Delivered to agent': it is Starting until output, then Working",
  () => {
    const ack = fromCommand({ claimed: true, executed: true });
    assert(ack.label === "Delivered to agent", `fixture drifted: ${ack.label}`);
    const submitted = alignLiveViewWithTrack(
      ack,
      withEvents(["dispatched", "claimed", "submitted"]),
    );
    assert(submitted.status === "starting", `ack alone read ${submitted.status}`);
    const generating = alignLiveViewWithTrack(
      ack,
      withEvents(["dispatched", "claimed", "submitted", "generating"], { phase: "working" }),
    );
    assert(generating.status === "working", `after output: ${generating.status}`);
    for (const v of [submitted, generating]) {
      assert(v.label !== "Delivered to agent", "still says Delivered");
    }
  },
);

check("for every open run the word and the track agree", () => {
  const tracks = [
    withEvents(["dispatched"]),
    withEvents(["dispatched"], { stalled: true }),
    withEvents(["dispatched", "claimed"]),
    withEvents(["dispatched", "claimed", "submitted"]),
    withEvents(["dispatched", "claimed", "generating"], { phase: "working" }),
  ];
  const views: DispatchLiveView[] = [
    fromCommand({}),
    fromCommand({ claimed: true }),
    fromCommand({ claimed: true, executed: true }),
    fromCommand({ claimed: true, executed: true }, "running"),
  ];
  for (const track of tracks) {
    for (const view of views) {
      const got = alignLiveViewWithTrack(view, track);
      assert(got.status === track.live, `${view.status} + ${track.live} gave ${got.status}`);
    }
  }
});

check("a settled view and a missing track are left alone", () => {
  const failed = deriveDispatchLiveStatus({
    claimedAt: AT,
    executedAt: AT,
    result: { ok: false, error: "Sandbox cwd does not exist" },
    run: null,
  });
  assert(alignLiveViewWithTrack(failed, withEvents(["dispatched"])) === failed, "failed rewritten");
  const queued = fromCommand({});
  assert(alignLiveViewWithTrack(queued, null) === queued, "no track");
});

check("both status routes answer through the alignment", () => {
  for (const rel of [
    "src/app/api/orchestration/runs/[id]/route.ts",
    "src/app/api/control/commands/[id]/route.ts",
  ]) {
    assert(
      /\.\.\.alignLiveViewWithTrack\(view, loaded\?\.track\),/.test(read(rel)),
      `${rel} returns a status of its own`,
    );
  }
});

check("the run route judges a queued run by its own command row", () => {
  const src = read("src/app/api/orchestration/runs/[id]/route.ts");
  assert(/getCommandById\(commandId\)/.test(src), "the command row is not read");
  assert(/claimedAt: queued \? queued\.claimedAt : null,/.test(src), "claim is assumed");
  assert(
    /executedAt: queued \? queued\.executedAt : run\.startedAt,/.test(src),
    "a queued run is treated as executed from the start",
  );
});

if (failures) {
  console.log(`\none-run-status: ${failures} failed`);
  process.exit(1);
}
console.log("\none-run-status: all passed");
