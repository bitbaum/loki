import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalOfflineActions } from "../../src/components/terminal/TerminalOfflineActions";
import { RunnerStatusBanner } from "../../src/components/control/RunnerStatusBanner";
Object.assign(globalThis, { React });
/**
 * The way forward from "nothing is running this work", per account.
 * Case from the report (2026-10-12): the owner on a second computer was sent
 * to download Fleet Runner while the account's cloud builder sat online.
 */
import {
  builderWayForward,
  cloudBuilderState,
  downloadIsTheWayForward,
} from "@/lib/builder-way-forward";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const online = { cloud: true, local: false, any: true };
const dark = { cloud: false, local: false, any: false };

check("owner, cloud up → online", cloudBuilderState(true, online) === "online");
check("owner, cloud down → offline", cloudBuilderState(true, dark) === "offline");
check(
  "other account → private, whatever presence says",
  cloudBuilderState(false, online) === "private",
);
check("before the first poll → unknown", cloudBuilderState(null, null) === "unknown");
check("allowed but presence not loaded → unknown", cloudBuilderState(true, null) === "unknown");

check(
  "work waiting for a laptop, cloud up: run it in the cloud",
  builderWayForward({ cloud: "online", waitingOn: "local" }) === "run-in-cloud",
);
check(
  "nothing waiting yet, cloud up: still the cloud, never a download",
  builderWayForward({ cloud: "online" }) === "run-in-cloud",
);
check(
  "waiting for the cloud while it is up is a queue, not a gap",
  builderWayForward({ cloud: "online", waitingOn: "cloud" }) === "unknown",
);
check(
  "cloud down for an account that has it: wait, nothing to install",
  builderWayForward({ cloud: "offline", waitingOn: "local" }) === "wait-for-cloud",
);
check(
  "private cloud: Fleet Runner is the only builder",
  builderWayForward({ cloud: "private", waitingOn: "local" }) === "connect-fleet-runner",
);
check("unknown stays unknown", builderWayForward({ cloud: "unknown" }) === "unknown");

check(
  "the download is honest only for a private cloud",
  downloadIsTheWayForward("connect-fleet-runner"),
);
check("…not while the cloud is merely down", !downloadIsTheWayForward("wait-for-cloud"));
check("…not before we know", !downloadIsTheWayForward("unknown"));

for (const cloud of ["unknown", "online", "offline", "private"] as const) {
  const banner = renderToStaticMarkup(
    createElement(RunnerStatusBanner, {
      runnerNeverSeen: true,
      runnerOffline: false,
      runnerLastPushedAt: null,
      cloud,
    }),
  );
  check(
    // Home shows a never-connected private builder as ONE row that names the
    // desktop app and opens the full setup; nobody else is told to install.
    `banner ${cloud}: the desktop app only for private access`,
    banner.includes("desktop app") === (cloud === "private"),
  );
  if (cloud === "unknown")
    check(
      "unknown banner checks connection without install guidance",
      !banner.includes("/download"),
    );
  const actions = renderToStaticMarkup(
    createElement(TerminalOfflineActions, {
      source: "machine",
      onSwitch() {},
      presence: {
        runnerConnected: false,
        runtimeAvailable: false,
        cloudBuilderAllowed: cloud === "unknown" ? null : cloud !== "private",
        builderPresence: cloud === "unknown" ? null : cloud === "online" ? online : dark,
      },
    }),
  );
  check(
    `terminal ${cloud}: download only for private access`,
    actions.includes("/download") === (cloud === "private"),
  );
}

console.log(`\n${passed}/${passed} builder-way-forward cases passed`);
