// Pins the two halves of the 2026-10-08 calendar-drain fix.
//
// WHY IT EARNS A TEST
// One approved event ("Schabernack @ Schneiderei") had its date only in the
// action's DESCRIPTION. The date rescue never read the description, so the
// booking failed — and a failed booking went straight back into a queue polled
// every 15 s. 38,851 failures in a week, a model call on each, and the operator
// never heard that the event was not in their calendar. Either half alone
// prevents a repeat: the rescue sees the description, and nothing retries
// forever.
import { MAX_BOOKING_ATTEMPTS, bookingVerdict } from "@/lib/actions/booking-attempts";
import { resolveGogCreateArgs, type EventRecovery } from "@/lib/actions/calendar-event";

const cases: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => cases.push([name, ok]);

check("a first failure is retried", bookingVerdict(1) === "retry");
check(
  "the attempt before the cap is still retried",
  bookingVerdict(MAX_BOOKING_ATTEMPTS - 1) === "retry",
);
check("the cap gives up", bookingVerdict(MAX_BOOKING_ATTEMPTS) === "give_up");
check("past the cap still gives up", bookingVerdict(MAX_BOOKING_ATTEMPTS + 50) === "give_up");
check("the cap is small — a person hears within a minute", MAX_BOOKING_ATTEMPTS <= 5);

const DESCRIPTION =
  "Sa 26.09.2026 22:00 - So 27.09.2026 04:00 | Schneiderei, Langstrasse 117, Zürich";

async function rescueSeesDescription() {
  let seen: string | null | undefined;
  const recover: EventRecovery = async (payload, _title, context) => {
    seen = context;
    // Stand-in for the model: it can only answer if the date reached it.
    return context?.includes("26.09.2026")
      ? {
          ...(payload ?? {}),
          eventStart: "2026-09-26T22:00:00+02:00",
          eventEnd: "2026-09-27T04:00:00+02:00",
        }
      : payload;
  };
  const args = await resolveGogCreateArgs(null, "Schabernack @ Schneiderei", recover, DESCRIPTION);
  check("the rescue is handed the row's description", seen === DESCRIPTION);
  check("an empty payload with a dated description resolves to a booking", Array.isArray(args));
}

async function structuredSkipsModel() {
  let called = false;
  const recover: EventRecovery = async (p) => {
    called = true;
    return p;
  };
  const args = await resolveGogCreateArgs(
    { eventStart: "2026-10-10T10:00:00+02:00", eventEnd: "2026-10-10T11:00:00+02:00" },
    "Structured",
    recover,
    DESCRIPTION,
  );
  check("a structured payload books without asking the model", Array.isArray(args) && !called);
}

void (async () => {
  await rescueSeesDescription();
  await structuredSkipsModel();
  for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
  const pass = cases.filter(([, ok]) => ok).length;
  console.log(`\n${pass}/${cases.length} passed`);
  if (pass !== cases.length) process.exit(1);
})();
