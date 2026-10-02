// Pins how /money reads a subscription's stored next-due date.
//
// The bug this guards: every active subscription rendered "Overdue <date>" in
// red, because `next_due` is set once and only moves on "Mark paid" — which
// nobody presses for a card that renews itself. Nine paid subscriptions, nine
// red "Overdue" labels. See src/lib/subscription-due.ts for the rule.
import { subscriptionDue, nextChargeDate } from "@/lib/subscription-due";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failed++;
}
const NOW = new Date("2026-10-02T12:00:00");
const ymd = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "null";

console.log("subscription-due:");

{
  const s = subscriptionDue(new Date("2026-05-14T00:00:00"), "monthly", { now: NOW });
  check(
    "a monthly date five months past rolls to the next charge, not 'overdue'",
    s.kind === "due" && s.rolled && ymd(s.date) === "2026-10-14",
    JSON.stringify(s),
  );
}
{
  const s = subscriptionDue(new Date("2026-10-02T00:00:00"), "monthly", { now: NOW });
  check("a charge due today is due today, unrolled", s.kind === "due" && !s.rolled);
}
{
  const s = subscriptionDue(new Date("2026-11-20T00:00:00"), "monthly", { now: NOW });
  check("a future date is left alone", s.kind === "due" && ymd(s.date) === "2026-11-20");
}
{
  const s = subscriptionDue(new Date("2026-01-31T00:00:00"), "monthly", { now: NOW });
  check(
    "the billing day survives a short month (31st stays end-of-month, not the 28th)",
    s.kind === "due" && ymd(s.date) === "2026-10-31",
    ymd(nextChargeDate(s)),
  );
}
{
  const s = subscriptionDue(new Date("2025-03-01T00:00:00"), "annual", { now: NOW });
  check("an annual renewal rolls by years", s.kind === "due" && ymd(s.date) === "2027-03-01");
}
{
  const s = subscriptionDue(new Date("2026-06-27T00:00:00"), "quarterly", { now: NOW });
  check(
    "a quarterly renewal rolls by three months",
    s.kind === "due" && ymd(s.date) === "2026-12-27",
  );
}
{
  const s = subscriptionDue(new Date("2026-09-01T00:00:00"), "weekly", { now: NOW });
  check("a weekly renewal rolls by weeks", s.kind === "due" && ymd(s.date) === "2026-10-06");
}
{
  const s = subscriptionDue(new Date("2026-04-07T00:00:00"), "one-time", { now: NOW });
  check("a past one-time charge reads as charged, never due", s.kind === "charged");
}
{
  const s = subscriptionDue(new Date("2026-04-07T00:00:00"), "monthly", {
    now: NOW,
    cancelled: true,
  });
  check("a cancelled subscription has no next charge", s.kind === "none");
}
check("no stored date means no next charge", subscriptionDue(null, "monthly").kind === "none");
check(
  "an unparseable date means no next charge",
  subscriptionDue("not a date", "monthly").kind === "none",
);
{
  const s = subscriptionDue(new Date("2026-08-10T00:00:00"), null, { now: NOW });
  check(
    "an unknown frequency rolls monthly, like Mark paid does",
    s.kind === "due" && ymd(s.date) === "2026-10-10",
  );
}

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
