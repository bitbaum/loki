const DEFAULT_ORANGECAT_ORIGIN = "https://www.orangecat.ch";

function readPublicUrl(name: string, fallback: string): URL {
  const value = process.env[name] ?? fallback;
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

const orangeCatOrigin = readPublicUrl("NEXT_PUBLIC_ORANGECAT_URL", DEFAULT_ORANGECAT_ORIGIN);
const lokiOrigin = readPublicUrl("NEXT_PUBLIC_LOKI_URL", "https://loki.orangecat.ch");
const solonOrigin = readPublicUrl("NEXT_PUBLIC_SOLON_URL", "https://solon.orangecat.ch");

function orangeCatPage(path: string): string {
  return new URL(path, orangeCatOrigin).toString();
}

/**
 * Where a proposal is filed on Solon. It reads `title`, `body`, `category` and
 * `from` from its query (solon: src/lib/domain/proposal-draft.ts) and keeps
 * them through sign-in, so a link from here lands pre-filled.
 */
export const SOLON_PROPOSE_URL = new URL("/propose", solonOrigin).toString();

/**
 * Public cross-product links live here so navigation, support, and project
 * surfaces cannot drift onto different OrangeCat entities.
 */
export const ECOSYSTEM = {
  owner: "Cato",
  orangeCat: {
    title: "OrangeCat",
    projectId:
      process.env.NEXT_PUBLIC_ORANGECAT_PROJECT_ID ?? "cb093f00-8745-4579-98df-050ebfb37181",
    // The retired pseudonym was in this URL, rendered publicly on /support.
    // The real username is not verifiable from outside — every /profile/*
    // path redirects to login — so this points at the OrangeCat home (200)
    // rather than guessing a slug. Repoint it once the handle is known.
    profileUrl: orangeCatPage("/"),
    siteUrl: orangeCatOrigin.toString(),
  },
  loki: {
    title: "Loki",
    projectId:
      process.env.NEXT_PUBLIC_LOKI_ORANGECAT_PROJECT_ID ?? "8130c927-114a-45b7-8cc2-99efd5224025",
    siteUrl: lokiOrigin.toString(),
  },
  solon: {
    title: "Solon",
    siteUrl: solonOrigin.toString(),
  },
  support: {
    lightningAddress:
      process.env.NEXT_PUBLIC_ECOSYSTEM_LIGHTNING_ADDRESS ?? "orangecat@getalby.com",
    bitcoinAddress:
      process.env.NEXT_PUBLIC_ECOSYSTEM_BITCOIN_ADDRESS ??
      "bc1q3hh4yklcmwtpnqmxyksw36yedg7zyfy6tzzqwz",
  },
} as const;

export const ECOSYSTEM_LINKS = {
  cato: ECOSYSTEM.orangeCat.profileUrl,
  orangeCat: orangeCatPage(`/projects/${ECOSYSTEM.orangeCat.projectId}`),
  loki: orangeCatPage(`/projects/${ECOSYSTEM.loki.projectId}`),
} as const;

/** Backwards-compatible shape for existing Loki money surfaces. */
export const ORANGECAT_INTEGRATION = {
  customer: ECOSYSTEM.loki.title,
  owner: ECOSYSTEM.owner,
  orangeCat: {
    title: ECOSYSTEM.orangeCat.title,
    projectUrl: ECOSYSTEM_LINKS.orangeCat,
    profile: ECOSYSTEM_LINKS.cato,
  },
  loki: {
    title: ECOSYSTEM.loki.title,
    projectUrl: ECOSYSTEM_LINKS.loki,
    site: ECOSYSTEM.loki.siteUrl,
  },
  wallet: {
    btc: ECOSYSTEM.support.bitcoinAddress,
    lightning: ECOSYSTEM.support.lightningAddress,
  },
  relation: "Loki is a customer of OrangeCat through the shared entity graph.",
  note: "OrangeCat is the public funding layer; Loki is the execution layer where the work gets done.",
} as const;

/**
 * What OrangeCat can do for a Loki operator, in one place.
 *
 * SSOT because two very different consumers say it and must not disagree: the
 * handoff/publish surfaces in `src/components/integrations`, and Loki's
 * capability preface (`src/lib/loki-core.ts`), which is a grounding contract —
 * Loki has been wrong about what a neighbouring system can do before, and the
 * fix each time was to bind it to a fact rather than to prose.
 *
 * NOTE THE BOUNDARY. These are OrangeCat's capabilities, not Loki's. Loki
 * cannot render a video; it can tell the operator where one gets rendered.
 */
export const ORANGECAT_CAPABILITIES = {
  // /studio 404s. This string is injected into Loki's grounding preface
  // (src/lib/loki-core.ts), so a dead path here makes the assistant send
  // operators to a 404. /create is the verified surface (200).
  studioUrl: orangeCatPage("/create"),
  // Where a signed-in person talks to their own Cat. The widget's Cat hands
  // off here: on a stranger's site it can explain and point, never move money.
  catUrl: orangeCatPage("/dashboard/cat"),
  lines: [
    'OrangeCat has a Studio that renders video, music, longform writing and artwork, and revises it from plain-language notes ("the middle drags", "colder light") rather than settings.',
    "Video, music and artwork there run on the operator's own AI provider key; writing runs on OrangeCat's free models.",
    "Work still being made is financed on OrangeCat as a project; finished work is sold as a product, settled in Bitcoin with no platform cut.",
  ],
} as const;
