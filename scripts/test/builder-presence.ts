/**
 * Inline tests for builder presence labels.
 * Run: npx tsx scripts/test/builder-presence.ts
 */
import {
  builderBehind,
  builderCompactLabel,
  builderUpdateNote,
  builderPresenceDetail,
  inferBuilderChannelPresence,
  isCloudRunnerVersion,
} from "@/lib/builder-presence";

if (!isCloudRunnerVersion("box-0.8.9")) throw new Error("box version detect");
if (isCloudRunnerVersion("0.8.9")) throw new Error("desktop version not cloud");

if (builderCompactLabel("connected", "box-0.8.9") !== "Cloud runner online") {
  throw new Error("cloud label");
}
if (builderCompactLabel("connected", "0.8.9") !== "This computer online") {
  throw new Error("local label");
}
if (
  builderCompactLabel("connected", "0.8.9", { cloud: true, local: true }) !==
  "Cloud + this computer online"
) {
  throw new Error("both label");
}
if (builderCompactLabel("offline", null) !== "Runner offline") {
  throw new Error("offline label");
}

const cloudOnly = inferBuilderChannelPresence({
  connected: true,
  cloudConnected: true,
  localConnected: false,
});
if (!cloudOnly.cloud || cloudOnly.local) throw new Error("cloud-only infer");
if (builderPresenceDetail(cloudOnly) !== "This computer offline — cloud runner runs the queue") {
  throw new Error("cloud-only detail");
}

console.log("✓ builder-presence tests passed");

// A builder behind the deploy says so; a current one, or one that never named
// a number, says nothing (a wrong "update waiting" is worse than none).
if (!builderBehind("box-0.8.44", "0.8.45")) throw new Error("older patch is behind");
if (!builderBehind("box-0.7.99", "0.8.0")) throw new Error("older minor is behind");
if (builderBehind("box-0.8.45", "0.8.45")) throw new Error("same version is not behind");
if (builderBehind("box-0.8.46", "0.8.45")) throw new Error("newer is not behind");
if (builderBehind("box", "0.8.45")) throw new Error("no number: no claim");
if (builderBehind(null, "0.8.45")) throw new Error("no runner: no claim");
if (builderUpdateNote("box-0.0.1") !== "a newer version waits for its agents to finish")
  throw new Error("update note");
if (builderUpdateNote(null) !== null) throw new Error("no runner, no note");
console.log("✓ builder-presence");
