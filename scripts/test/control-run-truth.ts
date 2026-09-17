import { isVerifiedRunActive } from "@/lib/control-run-truth";

const now = Date.parse("2026-09-17T06:30:00.000Z");

function assert(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

assert(
  isVerifiedRunActive(
    {
      finishedAt: null,
      payload: { injectVerified: true, lastProgressAt: "2026-09-17T06:29:00.000Z" },
    },
    now,
  ),
  "fresh verified generation must count as active",
);

assert(
  !isVerifiedRunActive(
    {
      finishedAt: null,
      payload: { injectVerified: false, lastProgressAt: "2026-09-17T06:29:00.000Z" },
    },
    now,
  ),
  "a rejected inject must never count as active",
);

assert(
  !isVerifiedRunActive(
    {
      finishedAt: null,
      payload: { injectVerified: true, lastProgressAt: "2026-09-17T06:00:00.000Z" },
    },
    now,
  ),
  "stale progress must never count as active",
);

assert(
  !isVerifiedRunActive(
    {
      finishedAt: "2026-09-17T06:29:30.000Z",
      payload: { injectVerified: true, lastProgressAt: "2026-09-17T06:29:00.000Z" },
    },
    now,
  ),
  "a finished run must never count as active",
);

console.log("4/4 control run truth tests passed");
