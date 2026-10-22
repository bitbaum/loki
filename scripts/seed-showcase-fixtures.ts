/**
 * What the showcase account contains: the rows scripts/seed-showcase.ts
 * writes, kept apart from how it writes them. Every name is fiction or the
 * owner's own project names; no real person, address or secret appears.
 */

export type Stage = "idea" | "blueprint" | "development" | "pre-launch" | "production" | "paused";

export type ProjectFixture = {
  name: string;
  /** Long on purpose: the owner's descriptions are task text pasted in. */
  description: string;
  stage?: string;
  maturity?: Stage;
  live?: boolean;
  /** Site probed and found down. */
  down?: boolean;
  /** No folder or repo: "Not connected". */
  disconnected?: boolean;
  paused?: boolean;
  deployIssue?: string;
  broken?: string;
  security?: string;
  nextStep?: string;
  updates?: "auto" | "ask" | "pinned";
  stack?: string;
  title?: string;
  clientWork?: boolean;
};

export const PROJECTS: ProjectFixture[] = [
  {
    name: "derhochhinhousepartyrenner-ch-refresh-68e1f4947961419d9e7c46f68e180a45",
    description:
      "Refresh of derhochhinhousepartyrenner.ch — the old site is a single Wix page. Keep the dates of the next three parties at the top, make the ticket link obvious on a phone, add the gallery from the Dropbox folder, German only for now. Client said: 'nicht zu bunt'.",
    stage: "development",
    maturity: "blueprint",
    live: true,
    clientWork: true,
    stack: "Next.js · Tailwind",
  },
  {
    name: "orangecat-2",
    description:
      "Second OrangeCat checkout — used for the studio rewrite while main stays deployable. Fix the funding page on phones (amount field hidden behind keyboard), then port the wallet card to the semantic tokens and delete the tiffany classes it still uses.",
    stage: "production",
    maturity: "production",
    live: true,
    nextStep: "Port the wallet card to semantic tokens",
    stack: "Next.js 16 · Supabase",
  },
  {
    name: "aoz-housing",
    description:
      "Housing search for AOZ clients. The list of flats must work with a screen reader and on a 5-year-old Android. Feedback widget is live and the case workers use it a lot — triage before adding features. Never show a client's name on a public page.",
    stage: "production",
    maturity: "production",
    live: true,
    clientWork: true,
    broken: "Map view on Android 9, PDF export of the shortlist",
    nextStep: "Triage the feedback queue",
    updates: "ask",
    stack: "Next.js · Postgres",
  },
  {
    name: "camille-boulangerie",
    description:
      "Bakery site for Camille: opening hours, the weekly bread list (changes every Monday), pre-order form that sends an email, French + German. She edits the bread list herself from her phone.",
    stage: "pre-launch",
    maturity: "blueprint",
    live: true,
    clientWork: true,
    stack: "Next.js · Resend",
  },
  {
    name: "Center SOM",
    description:
      "Center SOM — meditation centre schedule and booking. Need: course calendar, waitlist when full, Twint payment link, newsletter export to CSV every month for the board.",
    stage: "blueprint",
    maturity: "blueprint",
    disconnected: true,
    clientWork: true,
  },
  {
    name: "BiasLens",
    description:
      "Browser extension + site that highlights loaded language in news articles. Model runs locally. Make the onboarding three screens max; the current one is nine.",
    stage: "development",
    maturity: "blueprint",
    paused: true,
    stack: "TypeScript · WebExtension",
  },
  {
    name: "Xhiva",
    description:
      "Xhiva art portfolio — gallery with lightbox, artist statement, enquiries form. Images must load fast on mobile; the current hero is 4MB.",
    stage: "production",
    maturity: "production",
    live: true,
    down: true,
    clientWork: true,
  },
  {
    name: "substrata",
    description:
      "substrata — the knowledge base experiment. Next 16 canary. Ingest markdown, show backlinks, search through searchkit. Nothing public yet.",
    stage: "development",
    maturity: "blueprint",
    stack: "Next.js 16 · searchkit",
  },
  {
    name: "loki",
    description:
      "Loki itself. Home must answer 'what needs me' in one screen on a phone. The design reset brief (docs/development/design-reset-2026-10.md) is the bar.",
    stage: "production",
    maturity: "production",
    live: true,
    nextStep: "Design reset: Home, Projects, Feedback",
    stack: "Next.js 16 · Drizzle · Postgres",
  },
  {
    name: "solon",
    description:
      "Solon — governance. Signed votes, treasury watch-only, humans-only decision classes. Launch the first real org (the co-op) before adding anything else.",
    stage: "pre-launch",
    maturity: "production",
    live: true,
    nextStep: "Onboard the co-op as the first org",
    stack: "Next.js · Drizzle",
  },
  {
    name: "petvity",
    description:
      "petvity — dog walking marketplace idea. Two-sided: walkers set radius and price, owners book. Do not build payments until 10 walkers signed up by hand.",
    stage: "idea",
    disconnected: true,
  },
  {
    name: "farmaciadelparco",
    description:
      "Farmacia del Parco (Lugano) — opening hours, on-duty pharmacy rota, Italian only. Rota must update itself from the cantonal PDF every week; right now someone pastes it.",
    stage: "production",
    maturity: "production",
    live: true,
    clientWork: true,
    deployIssue: "Deploy failed: build exits 1 — NEXT_PUBLIC_SITE_URL missing on the box",
  },
  {
    name: "Annushka Wild Spirit Art",
    description:
      "Annushka Wild Spirit Art — paintings and workshops. She wants a shop for prints (Twint + card), a workshop calendar, and Instagram on the home page. English + Russian.",
    stage: "blueprint",
    maturity: "blueprint",
    disconnected: true,
    clientWork: true,
  },
  {
    name: "Zurich Sublet Compliance & Concierge Services",
    description:
      "Zurich Sublet Compliance & Concierge Services — landing page + intake form for landlords who want to sublet legally (Untermiete rules, notification letter template, checklist). Must say clearly it is not legal advice. Lead form to email + CRM.",
    stage: "idea",
    disconnected: true,
  },
  {
    name: "botsmann",
    description:
      "botsmann — boat-sharing scheduler for the Zürichsee club. Calendar per boat, fair-share rule (max 2 weekend slots per month), reminders by SMS.",
    stage: "development",
    maturity: "blueprint",
    paused: true,
  },
  {
    name: "Causius",
    description:
      "Causius — cause-tracking for small NGOs: one page per cause, funding goal, updates feed. Probably becomes an OrangeCat entity type instead; decide before more work.",
    stage: "paused",
    paused: true,
  },
  {
    name: "center-com",
    description:
      "center-com — comms tool for the centre (newsletter + SMS). Overlaps with Center SOM; merge or kill.",
    stage: "v2??",
    disconnected: true,
  },
  {
    name: "datacat",
    description:
      "datacat — dataset catalogue. Read Parquet/CSV from S3-compatible storage, show schema + sample rows, share a link with an access code.",
    stage: "development",
    maturity: "blueprint",
    live: true,
    down: true,
  },
  {
    name: "Farmhouse",
    description:
      "Farmhouse holiday rental — booking calendar synced from Airbnb iCal, house rules, the way there by train + bus. First deploy failed because the repo could not see the private template.",
    stage: "pre-launch",
    maturity: "blueprint",
    live: true,
    clientWork: true,
    deployIssue: "Deploy check failed 3 times in a row (preview build times out)",
    nextStep: "Fix the preview build timeout",
  },
  {
    name: "Bitbaum",
    description:
      "Bitbaum — the umbrella site: what we build, the portfolio (consented client work only), contact. Keep it to one page.",
    stage: "Production — portfolio pending consent from 3 clients",
    maturity: "production",
    live: true,
  },
  {
    name: "orangecat",
    description:
      "OrangeCat main. My Cat agent, entities, Bitcoin + Twint. The design token migration is half done — new components use the semantic tier, old ones migrate as touched.",
    stage: "production",
    maturity: "production",
    live: true,
    security: "Service-role key printed in a debug log (rotated, log not yet purged)",
    updates: "ask",
  },
  {
    name: "heidi",
    description:
      "heidi — Swiss German speaking practice. Audio upload, transcription, feedback per dialect. The microphone path needs a real-device check before every release.",
    stage: "production",
    maturity: "production",
    live: true,
  },
  {
    name: "evig",
    description:
      "evig — affordable durable hardware, repair, workshops. Rebrand from Revamp-IT is Layer A only; never rename the infra identifiers.",
    stage: "production",
    maturity: "production",
    live: true,
    updates: "pinned",
  },
  {
    name: "aoz-begleitung",
    description:
      "aoz-begleitung — volunteer matching for the AOZ mentoring programme. Same clients as aoz-housing; share the accessibility fixes.",
    stage: "live",
    maturity: "production",
    live: true,
    clientWork: true,
  },
  {
    name: "murphys-bar",
    description:
      "create website for Murphy's Bar — preview at murphys-bar.orangecat.ch behind the access code. Menu, quiz night every Tuesday, live football schedule.",
    stage: "development",
    maturity: "blueprint",
    live: true,
    clientWork: true,
  },
  {
    name: "xhiva-art-refresh-300d4c1e9b8a4f6e8b1d2a7c5e9f0b13",
    description:
      "Refresh of the Xhiva site — new gallery layout the artist sent as a sketch (photo in the chat), keep the old URLs working.",
    stage: "development",
    live: true,
    clientWork: true,
  },
  {
    name: "s-ink",
    description: "s-ink tattoo studio — booking request form, artists' pages, aftercare PDF.",
    stage: "blueprint",
    disconnected: true,
    clientWork: true,
  },
  {
    name: "datacat-web",
    description: "Old datacat front end. Superseded by datacat; archive once links are redirected.",
    stage: "archived",
  },
  {
    name: "fleet",
    description:
      "bitbaum/fleet — AGENTS.md, the package register, the auto-merge sweep. Change the sweep HERE, never in a product repo.",
    stage: "production",
    maturity: "production",
  },
  {
    name: "chatkit",
    description: "@bitbaum/chatkit — the conversation UI every product renders.",
    stage: "production",
    maturity: "production",
  },
  {
    name: "searchkit",
    description: "@bitbaum/searchkit — typo-tolerant search and highlighting.",
    stage: "production",
    maturity: "production",
  },
  {
    name: "whenkit",
    description: "@bitbaum/whenkit — dates in words.",
    stage: "production",
    maturity: "production",
  },
  {
    name: "accountkit",
    description: "@bitbaum/accountkit — sign-in, OrangeCat identity.",
    stage: "pre-launch",
    maturity: "production",
  },
  {
    name: "listkit",
    description: "@bitbaum/listkit — lists that stay usable at 300 rows on a phone.",
    stage: "development",
  },
  {
    name: "design-tokens",
    description: "@bitbaum/design-tokens — one package for colours and faces across the fleet.",
    stage: "production",
    maturity: "production",
  },
  {
    name: "bergbahn-tickets",
    description:
      "Mountain railway ticket resale idea — season passes people don't use. Check legality first.",
    stage: "idea",
    disconnected: true,
  },
  {
    name: "zahnarzt-wollishofen",
    description:
      "Dentist in Wollishofen — new patient form, emergency number at the top, opening hours. Their old site is not responsive at all.",
    stage: "blueprint",
    clientWork: true,
    live: true,
  },
  {
    name: "velo-kurier-zh",
    description:
      "Bike courier collective — order form with price by zone, rider rota, monthly invoice PDF per business customer.",
    stage: "development",
    paused: true,
  },
  { name: "test", description: "test", disconnected: true },
  { name: "untitled-project-3", description: "", disconnected: true },
  {
    name: "my-new-site",
    description: "New site from the kickoff form — no answers saved.",
    disconnected: true,
  },
  {
    name: "camille-boulangerie-refresh-9a1b2c3d4e5f60718293a4b5c6d7e8f9",
    description:
      "Second pass on Camille's site after her feedback: bigger bread photos, Sunday hours, remove the 'Blog' link (she will never write one).",
    stage: "development",
    live: true,
    clientWork: true,
  },
];

export const RUN_FAILURES = [
  { adapter: "grok", error: "Grok is not installed on the cloud builder, so nothing was started." },
  { adapter: "claude", error: 'no running agent for "substrata" on this runner' },
  {
    adapter: "claude",
    error: "Claude Code is signed out on the cloud builder — run /login there, then try again.",
  },
  {
    adapter: "codex",
    error: "The agent stopped answering after 45 minutes; nothing was committed.",
  },
  { adapter: "claude", error: "Build failed: Type error in src/app/page.tsx — 'title' is unused." },
] as const;

export const RUN_SUCCESSES = [
  {
    done: "Mobile menu closes on link tap; hero button no longer overlaps the text at 390px.",
    next: "Check the Impressum route — it 404s on the live site.",
  },
  {
    done: "Feedback item fixed: the date picker now opens on iOS Safari.",
    next: "Verify on a real phone; the simulator was fine before too.",
  },
  {
    done: "Dependency sweep: 14 updates, no behaviour change.",
    next: "Nothing queued.",
  },
  {
    done: "Replaced the 4MB hero with a 180KB AVIF and a blurred placeholder.",
    next: "Do the same for the gallery thumbnails.",
  },
  {
    done: "Contact form posts to the mail route; added a honeypot field against spam.",
    next: "Ask the client which address should receive the enquiries.",
  },
  {
    done: "Moved the opening hours into config so the owner edits one file.",
    next: "Add the Sunday hours she asked for.",
  },
] as const;

/** What case workers and clients write into aoz-housing's widget. */
export const AOZ_FEEDBACK = [
  "The menu button does nothing on my phone",
  "Can't find where to apply for a flat, the button is hidden",
  "Text is too small to read on the list page",
  "The map doesn't load (Android, Chrome)",
  "PDF export of my shortlist is empty",
  "Please add a filter for wheelchair access",
  "Dates are shown in English even though I chose German",
  "When I go back from a flat I lose my place in the list",
  "The photo gallery is very slow on mobile data",
  "Login code email never arrived",
  "Why does it say 'undefined' under the rent?",
  "The 'Contact case worker' link opens an empty email",
  "It would help to sort by distance to the tram",
  "Logo overlaps the title on small screens",
  "Footer links go to the old site",
  "I can't close the cookie banner",
  "Font is hard to read for older clients — more contrast please",
  "The 'next page' button jumps when the images load",
  "Search for 'Altstetten' finds nothing but there are flats there",
  "Please show the date a flat was added",
] as const;

export const AOZ_PAGES = ["/", "/flats", "/flats/42", "/apply", "/shortlist", "/contact", "/map"];

/** What visitors write on a small business site. */
export const SITE_FEEDBACK = [
  "Opening hours on the home page are wrong for Sunday",
  "The order form says sent but I never got an email",
  "Photos take forever to load on my phone",
  "Menu doesn't close after I tap a link",
  "Please add the price next to each item",
  "Map link opens the wrong address",
  "Text in French has a lot of German words in it",
  "The phone number isn't clickable",
  "Can't scroll the gallery on iPhone",
  "Booking calendar shows last month",
] as const;

export const SITE_PAGES = ["/", "/menu", "/order", "/gallery", "/contact", "/about"];

export const PERSON_FIXTURES = [
  ["Anna Keller", "AOZ case worker lead", "AOZ", "whatsapp"],
  ["Camille Dubois", "Owner, Boulangerie Camille", "Boulangerie Camille", "whatsapp"],
  ["Marco Bernasconi", "Pharmacist, Farmacia del Parco", "Farmacia del Parco", "email"],
  ["Annushka Wild", "Painter", "Wild Spirit Art", "telegram"],
  ["Lukas Meier", "Freelance designer", "Studio Meier", "telegram"],
  ["Sofia Rossi", "Front-end contractor", null, "email"],
  ["Jonas Huber", "Club secretary, Segelclub", "Segelclub Zürichsee", "phone"],
  ["Mira Patel", "Accessibility tester", null, "email"],
  ["Peter Brunner", "Landlord, Wiedikon", null, "phone"],
  ["Lea Schmid", "Board, Center SOM", "Center SOM", "whatsapp"],
  ["Noah Graf", "Developer, OrangeCat contributor", "OrangeCat", "telegram"],
  ["Elena Novak", "Photographer", null, "whatsapp"],
  ["Tim Ochsner", "Accountant", "Treuhand Ochsner", "email"],
  ["Yara Haddad", "Translator FR/DE", null, "email"],
  ["David Frei", "Bar owner, Murphy's", "Murphy's Bar", "in-person"],
  ["Rita Gerber", "Farmhouse owner", null, "phone"],
  ["Samuel Okafor", "Bitcoin meetup organiser", null, "telegram"],
  ["Ines Vogel", "Dentist, Wollishofen", "Praxis Vogel", "email"],
  ["Felix Kunz", "Bike courier, collective", "Velo-Kurier ZH", "whatsapp"],
  ["Hannah Berger", "Co-op treasurer", "Wohngenossenschaft", "email"],
  ["Omar Saleh", "Volunteer mentor", "AOZ", "whatsapp"],
  ["Clara Wyss", "Neighbour", null, "in-person"],
  ["Ben Ackermann", "Old colleague", null, "telegram"],
  ["Nina Steiner", "Partner applicant", null, "email"],
] as const;

/** Project, how many reports, and which kind of site wrote them. */
export const FEEDBACK_PLAN: [string, number, "aoz" | "site"][] = [
  ["aoz-housing", 73, "aoz"],
  ["camille-boulangerie", 8, "site"],
  ["orangecat-2", 3, "site"],
  ["Farmhouse", 2, "site"],
];

export const ALERTS: [string, string, string, string | null, number, string][] = [
  [
    "runner_update",
    "warning",
    "Fleet Runner needs an update on one computer",
    "The Fleet Runner on 'MacBook' is on 2026.09.28; the app is on 2026.10.20.",
    8,
    "/system",
  ],
  [
    "partner_application",
    "info",
    "New partner application",
    "Nina Steiner applied to build client sites with you.",
    19,
    "/settings",
  ],
  [
    "feedback_stalled",
    "warning",
    "82 feedback fixes stopped, and 2 are live for you to check",
    "Open Feedback to start the stopped ones again and confirm the ones that are live.",
    28,
    "/feedback",
  ],
  [
    "repo_missing",
    "urgent",
    "Datacat web's repository can't be found on GitHub",
    "It was deleted, renamed or made private. Agents can't start work there until you pick the right repository, or remove it from the project.\n\ndatacat-web → bitbaum/datacat-web",
    28,
    "/projects",
  ],
  [
    "run_failed",
    "warning",
    "Farmhouse: deploy check failed 4 times in a row",
    "Preview build timed out after 15 minutes.",
    0.8,
    "/projects",
  ],
  [
    "ci_failure",
    "warning",
    "Farmaciadelparco: deploy failed",
    "build exits 1 — NEXT_PUBLIC_SITE_URL missing on the box",
    3,
    "/projects",
  ],
  ["new_feedback", "info", "3 new feedback items on aoz-housing", null, 0.3, "/feedback"],
];

export const NEXT_BEST_BODY =
  "Look at the project as it is right now: open feedback, failing checks, the live site on a phone. Pick the ONE thing that most improves it for the person using it, do it, verify it, and write down what you did and what is next.";

export const PROMPTS: {
  name: string;
  body: string;
  description?: string;
  project?: string;
  runs?: number;
  days: number;
}[] = [
  { name: "Next Best Step", body: NEXT_BEST_BODY, runs: 41, days: 58 },
  { name: "Next Best Step", body: NEXT_BEST_BODY, runs: 3, days: 44 },
  { name: "Next Best Step", body: NEXT_BEST_BODY, runs: 0, days: 31 },
  { name: "Next Best Step", body: NEXT_BEST_BODY, runs: 7, days: 12 },
  {
    name: "Next best step",
    body: "Do the next most valuable thing on this project and tell me what it was.",
    runs: 18,
    days: 50,
  },
  {
    name: "Next-best-step (short)",
    body: "Next best step. One commit. Verify on the live site.",
    runs: 5,
    days: 20,
  },
  {
    name: "Fix the feedback",
    description: "Every item marked new, one commit each",
    body: "Go through the feedback items marked new for {{project}}. For each: reproduce, fix, commit with the item id in the message. Skip anything that needs the client to decide and list it at the end.",
    runs: 22,
    days: 40,
  },
  {
    name: "Phone pass at 390px",
    description: "No sideways scroll, nothing under the bottom bar",
    body: "Open every page of the live site at 390px wide. Fix horizontal overflow, tap targets under 44px and anything hidden behind fixed bars.",
    runs: 9,
    days: 25,
  },
  {
    name: "Deploy check",
    body: "Is what is on main what is live? If not, find out why and fix the deploy, not the symptom.",
    project: "Farmhouse",
    runs: 6,
    days: 9,
  },
  {
    name: "Weekly bread list",
    body: "Update the bread list on the home page from the text below:\n\n{{list}}",
    project: "camille-boulangerie",
    runs: 4,
    days: 33,
  },
];

export const THREADS: {
  title: string;
  keys: string[];
  channel?: string;
  msgs: [string, string][];
}[] = [
  {
    title: "loki · updates",
    keys: ["loki"],
    channel: "updates:loki",
    msgs: [
      ["assistant", "Pull request #1362 is open: Home answers 'what needs me' first."],
      ["assistant", "It's live. I checked Home on a phone — nothing scrolls sideways."],
      [
        "assistant",
        "The deploy of #1365 failed: the schema check found drift. Nothing changed on the site.",
      ],
    ],
  },
  {
    title: "aoz-housing · updates",
    keys: ["aoz-housing"],
    channel: "updates:aoz-housing",
    msgs: [
      ["assistant", "Fixing 'The map doesn't load (Android, Chrome)' — pull request #212."],
      ["assistant", "Merged, but the deploy failed — the site still shows the old version."],
      ["assistant", "A later deploy shipped it. The map loads on Android 9 now."],
    ],
  },
  {
    title: "camille-boulangerie · updates",
    keys: ["camille-boulangerie"],
    channel: "updates:camille-boulangerie",
    msgs: [["assistant", "The bread list for this week is live."]],
  },
  {
    title: "What's going on?",
    keys: ["aoz-housing"],
    msgs: [
      ["user", "What's going on?"],
      [
        "assistant",
        "The agent on aoz-housing is fixing feedback items one by one. It has done 4 of 11: the menu button, the cookie banner, the footer links and the contrast on the list page. Tests pass. Next it will look at the PDF export, which needs a library change.",
      ],
    ],
  },
  {
    title: "What's going on?",
    keys: ["Farmhouse"],
    msgs: [
      ["user", "What's going on?"],
      [
        "assistant",
        "Nothing is running on Farmhouse. The last four deploy checks failed the same way: the preview build times out after 15 minutes. It needs the client's Airbnb calendar link before the booking page can build.",
      ],
    ],
  },
  {
    title: "What's going on?",
    keys: ["substrata"],
    msgs: [
      ["user", "What's going on?"],
      [
        "assistant",
        'Nothing — there is no running agent for "substrata" on the cloud builder. Start one?',
      ],
    ],
  },
  {
    title: "create website for Murphy's Bar",
    keys: ["murphys-bar"],
    msgs: [
      ["user", "create website for Murphy's Bar"],
      ["assistant", "murphys-bar.orangecat.ch — is that the address you want?"],
      ["user", "yes"],
      [
        "assistant",
        "Building it now on the cloud builder, behind your access code. I'll post the link here when the first version is up.",
      ],
      [
        "assistant",
        "It's up: https://murphys-bar.orangecat.ch — menu, quiz night, football schedule.",
      ],
    ],
  },
  {
    title: "Why did the deploy fail on farmaciadelparco?",
    keys: ["farmaciadelparco"],
    msgs: [
      ["user", "Why did the deploy fail on farmaciadelparco?"],
      [
        "assistant",
        "The build stops because NEXT_PUBLIC_SITE_URL is not set on the box. It was added to the template in September and this site was created before that. Set it in the site's env and redeploy — I can do it if you say so.",
      ],
      ["user", "do it"],
    ],
  },
  {
    title: "Add milk to my list",
    keys: [],
    msgs: [
      ["user", "add milk and bread flour to my list"],
      ["assistant", "Added both to Today."],
    ],
  },
  {
    title: "Summarise last week",
    keys: [],
    msgs: [
      ["user", "what got done last week across everything?"],
      [
        "assistant",
        "23 runs finished, 6 failed. aoz-housing closed 14 feedback items. Camille's site went live. Farmhouse is stuck on the preview build. Three Fleet packages were updated in 9 projects.",
      ],
    ],
  },
  {
    title: "Plan the solon launch",
    keys: ["solon"],
    msgs: [
      ["user", "what do we need before the co-op can vote on solon?"],
      [
        "assistant",
        "Three things: the members imported (Hannah has the list), the first proposal written (the budget), and signed votes tested on two phones. The treasury stays watch-only.",
      ],
    ],
  },
  { title: "New chat", keys: [], msgs: [["user", "hi"]] },
];

export const CREW_TASKS: [string, string, string, number][] = [
  ["Test the flat list with VoiceOver", "assigned", "aoz-housing", 6],
  ["Photograph the new bread range", "accepted", "camille-boulangerie", 9],
  ["Design three logo options for Center SOM", "delivered", "Center SOM", 14],
  ["Translate the menu to French", "done", "murphys-bar", 22],
  ["Call the 12 walkers on the list", "declined", "petvity", 18],
  ["Write the aftercare PDF", "draft", "s-ink", 2],
];

export const ACTIONS: [string, string, string, string, number][] = [
  ["send_message", "draft", "Send Camille the preview link", "Her site is ready for a look.", 0.5],
  ["create_event", "draft", "Call with Anna about the shortlist export", "Thursday 14:00", 1.2],
  [
    "follow_up",
    "draft",
    "Follow up with Rita: Airbnb calendar link",
    "Farmhouse is blocked on it.",
    2,
  ],
  [
    "dispatch_prompt",
    "draft",
    "Fix 11 feedback items on aoz-housing",
    "Clustered from 73 reports.",
    3,
  ],
  ["import_person", "draft", "Add Nina Steiner to People", "From the partner application.", 19],
  ["send_email", "executed", "Invoice reminder to Murphy's Bar", "Sent.", 12],
  ["send_message", "rejected", "Ask Marco for the rota PDF", "Not needed anymore.", 25],
];

export const PACKAGE_VERSIONS: Record<string, string[]> = {
  "@bitbaum/chatkit": ["0.9.0", "0.8.2", "0.7.4"],
  "@bitbaum/searchkit": ["1.4.0", "1.3.1"],
  "@bitbaum/design-tokens": ["2.1.0", "2.0.3", "1.9.0"],
  "@bitbaum/accountkit": ["0.5.1", "0.4.0"],
  "@bitbaum/whenkit": ["0.3.0"],
  "@fleet/ai-forms": ["1.2.0", "1.1.0"],
};

export const SCHEDULED_JOBS: [string, string, string, boolean, string | null][] = [
  ["Morning brief", "0 7 * * 1-5", "Summarise overnight runs and what needs me.", true, null],
  ["Feedback triage", "0 7,11,15,19 * * *", "Cluster new feedback and propose fixes.", true, null],
  ["Weekly bread list reminder", "0 9 * * 1", "Remind Camille to send the bread list.", true, null],
  [
    "Dependency sweep",
    "0 4 * * 0",
    "Update dependencies in every project.",
    true,
    "Timed out after 600s",
  ],
  ["Uptime digest", "0 20 * * 5", "Which sites were down this week.", false, null],
];

export const GOALS: {
  title: string;
  progress: number;
  project?: string;
  target: number;
  milestones: [string, boolean][];
  status?: "active" | "completed";
  parent?: number;
}[] = [
  {
    title: "Ten paying client sites by the end of the year",
    progress: 40,
    target: -70,
    milestones: [
      ["Murphy's Bar live", true],
      ["Camille live", true],
      ["Farmhouse live", false],
      ["Zahnarzt signed", false],
    ],
  },
  {
    title: "aoz-housing feedback under 20 open",
    progress: 25,
    project: "aoz-housing",
    target: -14,
    milestones: [
      ["Cluster the 73 reports", true],
      ["Fix the Android map", false],
      ["PDF export", false],
    ],
    parent: 0,
  },
  {
    title: "Solon: first real vote",
    progress: 60,
    project: "solon",
    target: -30,
    milestones: [
      ["Members imported", true],
      ["Budget proposal written", true],
      ["Signed votes on two phones", false],
    ],
  },
  {
    title: "Loki design reset",
    progress: 15,
    project: "loki",
    target: -21,
    milestones: [
      ["Brief written", true],
      ["Home", false],
      ["Projects", false],
      ["Feedback", false],
    ],
  },
  {
    title: "Run 5k under 25 minutes",
    progress: 70,
    target: -40,
    milestones: [
      ["Under 28", true],
      ["Under 26", true],
      ["Under 25", false],
    ],
  },
  {
    title: "Move hosting off the old VPS",
    progress: 100,
    target: 20,
    status: "completed",
    milestones: [["Everything on bitbaum", true]],
  },
];

export const HABITS: [string, "daily" | "weekdays" | "weekly", number, number | null][] = [
  ["Read before writing", "daily", 0.8, null],
  ["Close one loop a day", "weekdays", 0.6, 0],
  ["Run", "weekly", 0.9, 4],
  ["No phone after 22:00", "daily", 0.35, null],
  ["Triage feedback", "weekdays", 0.5, 1],
];

export const COMMITMENTS: [string, number, string | null, string | null][] = [
  ["Send Camille the invoice for the refresh", 3, "CHF 1'200", "camille-boulangerie"],
  ["Walk through the Farmhouse booking flow with Rita", -2, null, "Farmhouse"],
  ["Renew the orangecat.ch domain", -12, "CHF 18", null],
  ["Pay the Hetzner invoice", 1, "EUR 61", null],
  ["Answer Nina's partner application", 19, null, null],
];

export const SUBSCRIPTIONS: [string, string, number, string, string, string, number][] = [
  ["Hetzner", "Hetzner Online", 61.4, "EUR", "monthly", "infrastructure", 1],
  ["Claude Max", "Anthropic", 200, "USD", "monthly", "ai", 9],
  ["GitHub Team", "GitHub", 4, "USD", "monthly", "dev", 14],
  ["OpenAI", "OpenAI", 20, "USD", "monthly", "ai", 4],
  ["Groq", "Groq", 0, "USD", "monthly", "ai", 20],
  ["Domains", "Infomaniak", 140, "CHF", "annual", "infrastructure", 70],
  ["Figma", "Figma", 15, "USD", "monthly", "design", 11],
  ["Swisscom mobile", "Swisscom", 65, "CHF", "monthly", "phone", 6],
  ["Spotify", "Spotify", 13.95, "CHF", "monthly", "personal", 17],
  ["ZVV Abo", "ZVV", 809, "CHF", "annual", "transport", 120],
  ["Old VPS", "DigitalOcean", 12, "USD", "monthly", "infrastructure", -3],
];

export const EVENTS: [string, string, number, string, "active" | "archived"][] = [
  ["Bitcoin Meetup Zürich", "meetup", -6, "Zürich", "active"],
  ["Innosuisse grant deadline", "grant", -18, "online", "active"],
  ["Swiss Startup Days", "conference", -34, "Bern", "active"],
  ["Hackathon: civic tech", "hackathon", -11, "Basel", "active"],
  ["AOZ quarterly review", "meeting", -3, "AOZ office", "active"],
  ["Web Summit", "conference", 25, "Lisbon", "archived"],
  ["Co-op general assembly", "meeting", 9, "Zürich", "archived"],
];
