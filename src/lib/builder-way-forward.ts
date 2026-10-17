import type { BuilderChannel } from "@/lib/constants/statuses";

/**
 * What the cloud builder is to THIS account, from the two facts every surface
 * already has: may the account use it, and is it connected right now.
 *
 * Four states, not two, because "offline" and "private" need different
 * sentences: a private cloud means Fleet Runner is the only builder this
 * account will ever have, while an offline one is a service on the box that
 * will be back — nothing to install either way.
 */
export type CloudBuilderState = "online" | "offline" | "private" | "unknown";

export function cloudBuilderState(
  cloudBuilderAllowed: boolean | null | undefined,
  presence: { cloud: boolean } | null | undefined,
): CloudBuilderState {
  if (cloudBuilderAllowed === false) return "private";
  if (cloudBuilderAllowed !== true || !presence) return "unknown";
  return presence.cloud ? "online" : "offline";
}

/**
 * The one way forward from "nothing is running this work", as the SSOT every
 * surface reads: the dispatch card under a Loki message, the Control setup
 * banner, the empty terminal.
 *
 * Why this exists: on 2026-10-12 the owner opened Loki on a second computer.
 * Every surface named "this computer" as the builder, said Fleet Runner was
 * not connected (true — on that computer), and offered one fix: download the
 * desktop app. The account has the cloud builder, which was online the whole
 * time, and the download it got was an unsigned build macOS refuses to open.
 * Three screens pushed an install at a person who needed none.
 *
 * "This computer" is per ACCOUNT, not per device — presence is one row per
 * user — so from a second device the honest answer is never "install here".
 *
 *   run-in-cloud          the account has the cloud builder and it is up:
 *                         move the work there, nothing to install.
 *   wait-for-cloud        the account has the cloud builder and it is down:
 *                         a service to restart on the box, not an app to get.
 *   connect-fleet-runner  the cloud is private for this account: Fleet Runner
 *                         on a computer of theirs is the only builder.
 *   unknown               the first presence poll has not landed; say nothing
 *                         that pushes a download.
 */
export type BuilderWayForward =
  "run-in-cloud" | "wait-for-cloud" | "connect-fleet-runner" | "unknown";

export function builderWayForward(input: {
  cloud: CloudBuilderState;
  /** The builder the work is waiting on, when that is known. */
  waitingOn?: BuilderChannel | null;
}): BuilderWayForward {
  switch (input.cloud) {
    case "private":
      return "connect-fleet-runner";
    case "unknown":
      return "unknown";
    case "offline":
      return "wait-for-cloud";
    case "online":
      // Waiting on the cloud while it is online is a queue, not a gap: the
      // builder will claim it. The way forward is to wait, and the caller's
      // own "queued" copy says so.
      return input.waitingOn === "cloud" ? "unknown" : "run-in-cloud";
  }
}

/** True when a download link is an honest next step for this account. */
export function downloadIsTheWayForward(way: BuilderWayForward): boolean {
  return way === "connect-fleet-runner";
}

/**
 * Who can build this account's work, in words the operator can act on.
 *
 * It used to be "OFFLINE — nothing can run" for every account without a live
 * builder, and on the live site (2026-10-15) a new account was told to "bring
 * the runner online" — something it had no way to do: the cloud builder is
 * not available to that account at all, and the only builder it can ever have
 * is Fleet Runner on its own computer. Offline and unavailable are different
 * sentences with different next steps, so the fact says which one is true.
 */
export function builderStatusLine(
  access: {
    cloudBuilderAllowed: boolean;
    presence: { cloud: boolean; local: boolean; any: boolean };
  } | null,
): string | null {
  if (!access) return null;
  // Written as answers to "can new work start right now?", in the words a
  // person who has never heard "runner" or "builder" can act on — the model
  // repeats these sentences nearly verbatim.
  if (access.presence.any) {
    return access.presence.cloud
      ? "yes — Loki's own computers are building for this account"
      : "yes — the Loki desktop app is connected on the operator's computer";
  }
  const way = builderWayForward({
    cloud: cloudBuilderState(access.cloudBuilderAllowed, access.presence),
  });
  if (way === "connect-fleet-runner") {
    return "no — nothing can be built for this account yet. Building needs a computer, and Loki's own computers are not available to this account, so the one way is the Loki desktop app on a computer the operator owns ([Get the desktop app](/download)). Nothing they do in this chat changes that";
  }
  if (way === "wait-for-cloud") {
    return "not right now — Loki's own computers are offline, a problem on Loki's side with nothing for the operator to install or fix; work already sent starts when they are back";
  }
  return "not known yet — no computer has reported in";
}
