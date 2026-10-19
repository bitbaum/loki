/**
 * A build a new account asked for on /change, waiting for a person.
 *
 * Previews are built by the fleet's own cloud builder, which only the
 * operator's account may use (lib/execution-access) — it is not a tenant
 * boundary. So a stranger's "Make it real" used to end in a 403. Now it files
 * a request; the operator reads it (with the before/after the visitor saw)
 * and approves or declines it on /approvals. An approved one is built as the
 * operator's client work, behind a code that opens that one preview only, and
 * the visitor follows it on /change/requests/<id>. Decided 2026-10-19.
 */
export const BUILD_REQUEST_STATUSES = ["waiting", "building", "declined"] as const;
export type BuildRequestStatus = (typeof BUILD_REQUEST_STATUSES)[number];

export const BUILD_REQUESTS = {
  /** The visitor's page for one request. */
  pagePath: (id: string) => `/change/requests/${id}`,
  /** Where the operator decides. */
  reviewPath: "/approvals#build-requests",
  /** A before/after picture as it arrives from the instant preview (data URL). */
  lookMaxChars: 400_000,
  summaryMax: 240,
  noteMax: 1000,
  /** Requests shown to the operator at once. */
  listLimit: 30,
} as const;

/** What the visitor reads, per state — one place. */
export const BUILD_REQUEST_COPY = {
  waiting: {
    title: "A person reads it first",
    body: "Every new version is built on Loki’s own computers, so a person reads each request before one starts. You will get an email when it starts, and this page will show the link.",
  },
  building: {
    title: "Your new version is being built",
    body: "Loki’s agents are building it now. It is ready in a few minutes; open it with the code below. Your live site is not touched.",
  },
  declined: {
    title: "This one was not started",
    body: "A person read your request and did not start a build this time.",
  },
} as const satisfies Record<BuildRequestStatus, { title: string; body: string }>;
