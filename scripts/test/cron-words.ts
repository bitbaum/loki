/**
 * A schedule picked in words becomes the right cron line, and a cron line
 * reads back as words.
 *
 * Found on /prompts from a phone, 2026-10-20: the Schedule Job dialog asked
 * for "Schedule (cron)" in a text box holding "0 9 * * 1", with examples
 * underneath. A person picks "every weekday at 08:00"; Loki writes the line.
 * These pin both directions, and the check that refuses a line the scheduler
 * would not understand before Create, not after the first run never comes.
 *
 * Run: npx tsx scripts/test/cron-words.ts
 */
import assert from "node:assert/strict";
import {
  cronFromPick,
  cronProblem,
  describeCron,
  pickFromCron,
  timeZoneInWords,
  type SchedulePick,
} from "../../src/lib/cron-words";
import { CreateCronBody, humanCronSchedule } from "../../src/lib/crons-shared";
import { PROMPT_TEMPLATES } from "../../src/config/prompt-library";

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

const pick = (over: Partial<SchedulePick>): SchedulePick => ({
  kind: "weekly",
  time: "09:00",
  weekday: 1,
  monthDay: 1,
  cron: "",
  ...over,
});

console.log("cron-words:");

check("each pick in words writes its cron line", () => {
  assert.equal(cronFromPick(pick({ kind: "daily", time: "07:30" })), "30 7 * * *");
  assert.equal(cronFromPick(pick({ kind: "weekdays", time: "08:00" })), "0 8 * * 1-5");
  assert.equal(cronFromPick(pick({ kind: "weekly", weekday: 5, time: "18:00" })), "0 18 * * 5");
  assert.equal(cronFromPick(pick({ kind: "monthly", monthDay: 15, time: "09:00" })), "0 9 15 * *");
  assert.equal(cronFromPick(pick({ kind: "custom", cron: "  0  7,19 * * * " })), "0 7,19 * * *");
});

check("a suggested schedule opens as the pick it stands for, not as digits", () => {
  assert.deepEqual(
    (({ kind, time, weekday }) => ({ kind, time, weekday }))(pickFromCron("0 10 * * 1")),
    { kind: "weekly", time: "10:00", weekday: 1 },
  );
  assert.equal(pickFromCron("0 17 * * 1-5").kind, "weekdays");
  assert.equal(pickFromCron("30 3 * * *").kind, "daily");
  assert.equal(pickFromCron("0 9 1 * *").kind, "monthly");
  assert.equal(pickFromCron("0 7,11,15,19 * * *").kind, "custom");
  assert.equal(pickFromCron("0 9 * * 7").weekday, 0, "7 is Sunday too");
});

check("every pick round-trips through its own cron line", () => {
  for (const p of [
    pick({ kind: "daily", time: "06:05" }),
    pick({ kind: "weekdays", time: "23:59" }),
    pick({ kind: "weekly", weekday: 0, time: "00:00" }),
    pick({ kind: "monthly", monthDay: 28, time: "12:30" }),
  ]) {
    const back = pickFromCron(cronFromPick(p));
    assert.equal(back.kind, p.kind);
    assert.equal(back.time, p.time);
  }
});

check("every library default's suggested schedule is valid and reads as words", () => {
  for (const t of PROMPT_TEMPLATES) {
    if (!t.suggestedSchedule) continue;
    assert.equal(cronProblem(t.suggestedSchedule), null, `${t.id}: ${t.suggestedSchedule}`);
    assert.ok(describeCron(t.suggestedSchedule), `${t.id} has no words: ${t.suggestedSchedule}`);
  }
});

check("schedules read as a person would say them", () => {
  assert.equal(describeCron("0 9 * * 1"), "Every Monday at 09:00");
  assert.equal(describeCron("0 8 * * 1-5"), "Every weekday (Monday to Friday) at 08:00");
  assert.equal(describeCron("30 3 * * *"), "Every day at 03:30");
  assert.equal(describeCron("0 9 1 * *"), "On the 1st of every month at 09:00");
  assert.equal(describeCron("0 9 22 * *"), "On the 22nd of every month at 09:00");
  assert.equal(describeCron("0 20 * * 0-4"), "Sunday to Thursday at 20:00");
  assert.equal(describeCron("0 7,19 * * *"), "Every day at 07:00 and 19:00");
  assert.equal(describeCron("0 9 * * mon,wed,fri"), "Every Monday, Wednesday and Friday at 09:00");
});

check("a shape with no plain sentence is not guessed at", () => {
  assert.equal(describeCron("*/15 * * * *"), null);
  assert.equal(describeCron("0 9 * 1 *"), null);
});

check("a line the scheduler cannot read is refused, in words", () => {
  for (const bad of [
    "",
    "0 9 * *",
    "0 25 * * *",
    "61 9 * * *",
    "0 9 * * 8",
    "0 9 0 * *",
    "x y z w v",
  ]) {
    const problem = cronProblem(bad);
    assert.ok(problem, `"${bad}" should be refused`);
    assert.ok(!/undefined|NaN/.test(problem!), problem!);
  }
  for (const good of ["*/15 * * * *", "0 9 * * MON-FRI", "0 0 1 JAN *", "5 4 * * 0,6"]) {
    assert.equal(cronProblem(good), null, good);
  }
});

check("the API refuses the same lines the dialog does", () => {
  const body = { name: "x", message: "y" };
  assert.equal(CreateCronBody.safeParse({ ...body, scheduleExpr: "0 9 * * 1" }).success, true);
  const refused = CreateCronBody.safeParse({ ...body, scheduleExpr: "0 25 * * *" });
  assert.equal(refused.success, false);
  assert.match(refused.error!.issues[0]!.message, /hour/);
});

check("the job list falls back to the same words", () => {
  assert.equal(
    humanCronSchedule("0 10 * * 1", "Europe/Zurich"),
    "Every Monday at 10:00 (Europe/Zurich)",
  );
});

check("a time zone names its place and the exact zone", () => {
  assert.equal(timeZoneInWords("Europe/Zurich"), "Zurich time (Europe/Zurich)");
  assert.equal(timeZoneInWords("America/New_York"), "New York time (America/New_York)");
  assert.equal(timeZoneInWords("UTC"), "UTC");
});

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall passed");
