/** Honest copy for the Today action queue. SSOT so the card, buttons, and
 *  result states cannot disagree about what Approve actually does. */
export const ACTION_COPY = {
  checkin: {
    groupTitle: (n: number) => `Reach out to ${n} people`,
    groupWhy:
      "These contacts went quiet. Reminding you does not message them — it puts a due date on Today under Commitments.",
    remind: "Remind me",
    remindAll: (n: number) => `Remind me about all (${n})`,
    reminded: "Reminder set. It is under Commitments on Today.",
    remindedAll: (n: number) =>
      `${n} reminders set. They are under Commitments on Today. Nobody was contacted.`,
    noChannel: "No email, phone, or chat on file",
    never: "No conversation logged",
    last: (when: string) => `Last talk ${when}`,
    open: "Open",
    skip: "Skip",
  },
  dispatch: {
    sent: (project: string) => `Sent to ${project}. An agent is picking it up.`,
    watch: "Watch on Home",
    stay: "Back to the queue",
    failed: "The agent did not start. Try again — the proposal is still here.",
    deferred: "Queued, but nothing is running yet. Open Home to see why.",
  },
} as const;
