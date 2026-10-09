/**
 * Inline tests for multitenant execution routing.
 * Run: npx tsx scripts/test/execution-access.ts
 */
import {
  decideQueuedExecution,
  offlineFallbackChannel,
  type ExecutionAccess,
} from "@/lib/execution-access";

function access(input: {
  cloudBuilderAllowed: boolean;
  cloud?: boolean;
  local?: boolean;
}): ExecutionAccess {
  return {
    userId: "user-test",
    cloudBuilderAllowed: input.cloudBuilderAllowed,
    presence: {
      cloud: input.cloud ?? false,
      local: input.local ?? false,
      any: Boolean(input.cloud || input.local),
    },
  };
}

const founderCloud = decideQueuedExecution(access({ cloudBuilderAllowed: true, cloud: true }), {
  defaultChannel: "cloud",
});
if (!founderCloud.ok || founderCloud.channel !== "cloud" || founderCloud.runnerConnected !== true) {
  throw new Error("founder cloud routing");
}

const founderCloudOffline = decideQueuedExecution(access({ cloudBuilderAllowed: true }), {
  defaultChannel: "cloud",
});
if (
  !founderCloudOffline.ok ||
  founderCloudOffline.channel !== "cloud" ||
  founderCloudOffline.runnerConnected !== false
) {
  throw new Error("founder cloud offline queue");
}

const tenantLocal = decideQueuedExecution(access({ cloudBuilderAllowed: false, local: true }), {
  defaultChannel: "cloud",
});
if (!tenantLocal.ok || tenantLocal.channel !== "local" || tenantLocal.runnerConnected !== true) {
  throw new Error("tenant reroutes to local builder");
}

const tenantNoBuilder = decideQueuedExecution(access({ cloudBuilderAllowed: false }), {
  defaultChannel: "cloud",
});
if (
  tenantNoBuilder.ok ||
  tenantNoBuilder.status !== 409 ||
  tenantNoBuilder.code !== "builder-required"
) {
  throw new Error("tenant without builder must not queue into the void");
}

const tenantExplicitCloud = decideQueuedExecution(
  access({ cloudBuilderAllowed: false, local: true }),
  { requestedChannel: "cloud" },
);
if (
  tenantExplicitCloud.ok ||
  tenantExplicitCloud.status !== 403 ||
  tenantExplicitCloud.code !== "cloud-builder-private"
) {
  throw new Error("tenant explicit cloud must be blocked");
}

console.log("✓ execution-access tests passed");

// ── Offline fallback: a preference for a shut laptop does not park the work ─
{
  const CLONEABLE = "https://github.com/bitbaum/loki.git";
  // Preference for this computer, cloneable repo, no lock: may fall through.
  if (offlineFallbackChannel({ gitUrl: CLONEABLE, builderPref: "local" }) !== "cloud") {
    throw new Error("a local preference on a cloneable repo falls through to the cloud");
  }
  // Locked to the laptop (a tree with no repo): never.
  if (offlineFallbackChannel({ dirPath: "/home/g/dev/scratch", builderPref: "local" }) !== null) {
    throw new Error("a locus lock never falls through");
  }
  // Cloud preference: the desktop does not clone on demand, so never.
  if (offlineFallbackChannel({ gitUrl: CLONEABLE }) !== null) {
    throw new Error("cloud work does not fall through to a laptop");
  }

  // Laptop off, cloud on → the cloud takes it and says where it came from.
  const fell = decideQueuedExecution(access({ cloudBuilderAllowed: true, cloud: true }), {
    requestedChannel: "local",
    offlineFallback: "cloud",
  });
  if (
    !fell.ok ||
    fell.channel !== "cloud" ||
    fell.reroutedFrom !== "local" ||
    !fell.runnerConnected
  ) {
    throw new Error("offline local preference falls through to the online cloud");
  }
  // Laptop on → stays put, nothing to report.
  const stays = decideQueuedExecution(
    access({ cloudBuilderAllowed: true, cloud: true, local: true }),
    { requestedChannel: "local", offlineFallback: "cloud" },
  );
  if (!stays.ok || stays.channel !== "local" || stays.reroutedFrom !== undefined) {
    throw new Error("an online preference is honoured");
  }
  // Both off → queues for the chosen one, visibly.
  const both = decideQueuedExecution(access({ cloudBuilderAllowed: true }), {
    requestedChannel: "local",
    offlineFallback: "cloud",
  });
  if (!both.ok || both.channel !== "local" || both.runnerConnected !== false || both.reroutedFrom) {
    throw new Error("no online sibling → queue for the chosen builder");
  }
  // A tenant without cloud access never falls through to the shared box.
  const tenant = decideQueuedExecution(access({ cloudBuilderAllowed: false, cloud: true }), {
    requestedChannel: "local",
    offlineFallback: "cloud",
  });
  if (tenant.ok) throw new Error("tenant without cloud access must not fall through to it");
}
console.log("✓ execution-access offline fallback");
