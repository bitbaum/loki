/**
 * One ask, one action. Case from the live site (2026-10-15): "dentist on
 * Monday at 9am" was queued as "Dentist Appointment" by the message miner and
 * "Dentist appointment" by the model's propose_action — and the standing
 * calendar rule booked both.
 */
import { isSameRequest } from "@/lib/actions/same-request";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const ev = (title: string, payload: Record<string, unknown> = {}) => ({
  type: "create_event",
  title,
  payload,
});

check(
  "case alone does not make a second booking",
  isSameRequest(ev("Dentist Appointment"), ev("Dentist appointment")),
);
check(
  "a shorter title inside a longer one is the same ask",
  isSameRequest(ev("Dentist"), ev("Dentist appointment")),
);
check(
  "same day, different time format",
  isSameRequest(
    ev("Dentist", { eventStart: "2026-10-19T09:00:00+02:00" }),
    ev("Dentist appointment", { eventDate: "2026-10-19" }),
  ),
);
check(
  "a different day is a different appointment",
  !isSameRequest(
    ev("Dentist", { eventStart: "2026-10-19T09:00:00+02:00" }),
    ev("Dentist", { eventStart: "2026-10-26T09:00:00+01:00" }),
  ),
);
check("different things are different", !isSameRequest(ev("Dentist appointment"), ev("Team sync")));
check(
  "an event and a commitment are different kinds",
  !isSameRequest(ev("Dentist"), { type: "create_commitment", title: "Dentist" }),
);
check("an empty title never matches", !isSameRequest(ev(""), ev("Dentist")));
check(
  "filler words do not count",
  isSameRequest(ev("Dentist appointment on Monday"), ev("the dentist appointment Monday")),
);

const msg = (body: string) => ({ type: "send_message", title: "Message Anna", payload: { body } });
check("the same message twice is one", isSameRequest(msg("Running late"), msg("running  late")));
check(
  "two different messages to Anna are two",
  !isSameRequest(msg("Running late"), msg("Dinner at 8?")),
);

console.log(`\nsame-request: ${passed} passed`);
