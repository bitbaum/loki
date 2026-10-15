/**
 * Personal actions are answered and drafted for approval, never built.
 *
 * Found in production on 2026-10-15 with a one-project account: a calendar
 * event and a commitment were dispatched to the project as build work and
 * failed, instead of being drafted for approval in the chat.
 * Run: npx tsx scripts/test/personal-action-routing.ts
 */
import assert from "node:assert/strict";
import {
  isPersonalActionRequest,
  looksLikeDispatchTask,
  resolveCommand,
} from "@/lib/command-resolve";

const personal = [
  "Put an event in my calendar: dentist appointment on Monday at 9am.",
  "Add a commitment for me: send the new bakery menu to Anna by Friday.",
  "Remind me to call my dentist on Monday at 9am.",
  "Send Anna a WhatsApp saying I'll be ten minutes late",
  "Email the landlord about the heating",
  "Schedule a meeting with Marco on Thursday at 3pm",
  "Book an appointment with the vet for Saturday",
  "Write a message to Lena that the menu is ready",
];
const build = [
  "add a calendar page to the app",
  "build the booking calendar feature for kivvi",
  "fix the email sending bug",
  "move forward on loki",
  "implement the reminder emails in orangecat",
  "create a contact form that sends an email",
  "Email the api owner? no — refactor the email endpoint",
];

for (const t of personal) {
  assert.ok(isPersonalActionRequest(t), `personal: ${t}`);
  assert.ok(!looksLikeDispatchTask(t), `not dispatched: ${t}`);
}
for (const t of build) assert.ok(!isPersonalActionRequest(t), `build, not personal: ${t}`);

async function main() {
  // End to end through the resolver, with ONE project and that project
  // selected — the exact production case. No model call is made on this path.
  const projects = ["prodtest-bakery"];
  for (const t of personal.slice(0, 3)) {
    const r = await resolveCommand({ text: t, projects, selectedProject: "prodtest-bakery" });
    assert.equal(r.kind, "chat", `routes to chat: ${t}`);
    assert.equal(r.projectKey, null);
  }
  // A real build ask on the sole project still dispatches.
  const b = await resolveCommand({
    text: "add a pricing page",
    projects,
    selectedProject: undefined,
  });
  assert.equal(b.kind, "command");
  assert.equal(b.projectKey, "prodtest-bakery");
  console.log("✓ personal action routing");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
