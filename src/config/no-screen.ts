/**
 * No-screen mode — SSOT for what a person can SAY to their fleet and what
 * each phrase does.
 *
 * Three consumers read this one list: the parser (lib/voice/commands.ts
 * recognises these kinds), the spoken "what can I say" answer, and the
 * marketing page. A phrase that appears on the public page but is not
 * understood by the parser is a lie the operator discovers with their eyes
 * closed, so the examples here are the ones the parser's tests feed it.
 *
 * Everything that is not one of these is a question for Loki, answered the
 * same way the Loki page answers it, then read aloud.
 */

export type VoiceCommandKind =
  | "status"
  | "waiting"
  | "failures"
  | "approve"
  | "reject"
  | "dispatch"
  | "pause"
  | "resume"
  | "help"
  | "repeat"
  | "quiet"
  | "end"
  | "ask";

export type VoiceCommandDoc = {
  kind: VoiceCommandKind;
  /** Example phrases, as a person says them. The first is the canonical one. */
  say: readonly string[];
  /** What happens, in the operator's words. */
  does: string;
};

export const NO_SCREEN_COMMANDS: readonly VoiceCommandDoc[] = [
  {
    kind: "status",
    say: ["Status", "What's going on?", "How's the fleet?"],
    does: "The briefing: who is working, what is waiting on you, what failed.",
  },
  {
    kind: "waiting",
    say: ["What's waiting on me?", "Approvals"],
    does: "Reads the approval queue, numbered, so you can answer by number.",
  },
  {
    kind: "approve",
    say: ["Approve the first one", "Approve all"],
    does: "Approves one by its number, or every open one. The same decision as the Approvals page.",
  },
  {
    kind: "reject",
    say: ["Reject number two"],
    does: "Rejects one by its number.",
  },
  {
    kind: "dispatch",
    say: ["Tell heidi to fix the header on the phone", "Orangecat: run the tests"],
    does: "Starts that work on that project, and tells you when it finishes.",
  },
  {
    kind: "failures",
    say: ["What failed?", "Read the last failure"],
    does: "The runs that ended in an error today, with the error.",
  },
  {
    kind: "pause",
    say: ["Pause everything", "Pause heidi"],
    does: "Autopilot off, on every project or on one. Nothing new starts until you resume.",
  },
  {
    kind: "resume",
    say: ["Resume everything", "Resume heidi"],
    does: "Autopilot back on.",
  },
  {
    kind: "repeat",
    say: ["Say that again"],
    does: "Reads the last thing it said once more.",
  },
  {
    kind: "quiet",
    say: ["Quiet", "Hold on"],
    does: "Stops talking and listens.",
  },
  {
    kind: "help",
    say: ["What can I say?"],
    does: "Reads this list.",
  },
  {
    kind: "end",
    say: ["End no-screen mode", "Goodbye"],
    does: "Ends the session. The microphone closes.",
  },
] as const;

/** How often the phone asks the server whether anything changed, while
 *  nothing is being said. Twenty seconds is the gap between an agent
 *  finishing and the person hearing it — fast enough to act on, slow enough
 *  that a phone in a pocket does not spend its battery on it. */
export const NO_SCREEN_POLL_MS = 20_000;

/** Announcements queued from one snapshot diff beyond this are dropped: a
 *  phone reconnecting after an hour must not read out sixty runs. */
export const NO_SCREEN_MAX_ANNOUNCEMENTS = 5;

/** The page's one URL. Linked from the sidebar, the marketing page and the essay. */
export const NO_SCREEN_APP_PATH = "/voice";
export const NO_SCREEN_PUBLIC_PATH = "/no-screen";

/** The essay that explains the mode; linked from the public page. */
export const NO_SCREEN_ESSAY_PATH = "/thoughts/the-fleet-in-your-ear";

/**
 * Public page copy (/no-screen). Plain words, every claim true of /voice on
 * main today — the sample exchange is composed by lib/voice/briefing from a
 * snapshot shaped like the one in its test, not typed to sound good.
 */
export const NO_SCREEN_PAGE = {
  eyebrow: "No-screen mode",
  title: "Run your fleet with your eyes closed.",
  lede: "Headphones in. One tap. The phone goes in your pocket. Loki reads your fleet aloud, listens for what you say, and tells you when something finishes or needs you.",
  cta: "Open no-screen mode",
  ctaNote: "Signed in, on any phone with a browser. Nothing to install.",
  essayCta: "Read how it is built",
  sample: [
    { who: "you", line: "Status." },
    {
      who: "loki",
      line: 'One agent is working: heidi for 12 minutes. One thing is waiting on you. Say "what\'s waiting" to hear it.',
    },
    { who: "you", line: "What's waiting on me?" },
    {
      who: "loki",
      line: 'One thing. First: Reply to the visitor who reported the broken header. Say "approve the first one" or "reject number one".',
    },
    { who: "you", line: "Approve the first one." },
    { who: "loki", line: "Approved: Reply to the visitor who reported the broken header." },
    { who: "you", line: "Tell orangecat to run the tests and fix what fails." },
    {
      who: "loki",
      line: "Sent to orangecat: run the tests and fix what fails. I'll tell you when it finishes.",
    },
    { who: "later", line: "heidi finished: Header fits at 320 pixels." },
  ],
  steps: [
    {
      title: "Press Start, once.",
      body: "The microphone opens and Loki reads the briefing: who is working, what is waiting on you, what failed. That is the last time you need the screen.",
    },
    {
      title: "Say it.",
      body: "Status. What's waiting on me. Approve the first one. Tell heidi to fix the header. Anything else is a question, answered the way the Loki page answers it, then read to you.",
    },
    {
      title: "Put the phone away.",
      body: "Every twenty seconds the phone checks the fleet. A run that finished, a run that failed, a new approval, the builder dropping offline: each is one sentence in your ear, unasked.",
    },
  ],
  hears: [
    "A run finished, and what it did.",
    "A run failed, and the error.",
    "A new approval arrived. Say approve or reject.",
    "The builder went offline, or came back.",
    "A project started working.",
  ],
  button: {
    title: "The headphone button is the only button.",
    body: "Press it once to send what you just said, or to cut Loki off and talk. Press next to hear the briefing again. The lock screen shows what Loki is doing, for the one glance you allow yourself.",
  },
  limits: [
    {
      title: "It is a web page.",
      body: "The microphone, the voice and the headphone button are the phone's own, through the browser. We have run the loop in a desktop browser with a synthetic microphone; a locked iPhone in a pocket is the next test, and this line stays here until it passes.",
    },
    {
      title: "Your words leave the phone once.",
      body: "What you say is sent to the transcriber and discarded there; the text stays in Loki, in the same thread as the chat. Loki's answers are spoken by the phone itself and never leave it.",
    },
    {
      title: "Your PIN still holds.",
      body: "Approvals behind the private-zone PIN are not read aloud until you unlock them on screen. The briefing says they are locked rather than pretending there are none.",
    },
    {
      title: "Twenty seconds, not instant.",
      body: "Changes are read within the poll interval, not the moment they happen. Fast enough to act on, slow enough that a phone in a pocket keeps its battery.",
    },
  ],
} as const;
