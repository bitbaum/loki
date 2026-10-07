/**
 * The site consultation — what Loki tells you about your website BEFORE it
 * builds anything. SSOT for every check: the area it belongs to, how much it
 * costs you, the sentence a person reads, why it matters to their business,
 * and the instruction a build agent receives if they choose to fix it.
 *
 * Rules-only, no model, on purpose (same reasoning as lib/actions/advice-rules):
 * /change is anonymous, so a stranger's visit must not spend the shared free AI
 * quota, and every claim here must be one Loki can stand behind. A rule reads
 * the page and either finds the thing or does not — nothing is guessed, and a
 * check that cannot be judged from the page is skipped, never failed.
 *
 * Copy is written for an owner, not a developer: say what a visitor or Google
 * experiences, and what that costs, in one sentence each.
 */

export const CONSULT = {
  path: "/api/site-consult",
  /** Fetch budget for one page. A site slower than this is itself the finding. */
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 4,
  /** Per visitor: enough to check a site, fix the address and check again. */
  rateLimit: 12,
  /** A second look at the same address within this window is served from memory. */
  cacheMs: 10 * 60 * 1000,
  cacheEntries: 300,
  slowMs: 2_500,
  verySlowMs: 5_000,
  heavyHtmlBytes: 400 * 1024,
  thinTextWords: 40,
  titleMin: 10,
  titleMax: 65,
  altMissingShare: 0.2,
  userAgent:
    "Mozilla/5.0 (compatible; LokiSiteConsultation/1.0; +https://loki.orangecat.ch/change)",
} as const;

export const CONSULT_AREAS = {
  trust: "Trust",
  phones: "On a phone",
  found: "Getting found",
  customers: "Turning visitors into customers",
  speed: "Speed",
  access: "Usable by everyone",
} as const;
export type ConsultArea = keyof typeof CONSULT_AREAS;

/**
 * urgent  — it is costing visitors, enquiries or rankings today.
 * improve — a real gap, but not the reason someone left this morning.
 */
export const CONSULT_SEVERITY = {
  urgent: { label: "Costing you now", order: 0 },
  improve: { label: "Worth fixing", order: 1 },
} as const;
export type ConsultSeverity = keyof typeof CONSULT_SEVERITY;

type CheckCopy = {
  area: ConsultArea;
  severity: ConsultSeverity;
  /** What is wrong, as the owner would say it. */
  title: string;
  /** What it costs — visitors, enquiries, rankings, trust. */
  why: string;
  /** The instruction the build agent receives when this fix is chosen. */
  fix: string;
  /** Shown in "already right" when the check passes. */
  passed: string;
};

export const CONSULT_CHECKS = {
  "not-https": {
    area: "trust",
    severity: "urgent",
    title: "Browsers label your site “Not secure”",
    why: "Every browser shows that warning next to your address. Many visitors leave at that word, and nobody types a card number or an email address under it.",
    fix: "Serve every page over HTTPS with a valid certificate, and redirect every http:// address to its https:// version.",
    passed: "Served securely over HTTPS",
  },
  "mixed-content": {
    area: "trust",
    severity: "improve",
    title: "Parts of the page still load insecurely",
    why: "Browsers block insecure pictures and scripts on a secure page, so something on it is silently missing or broken for your visitors.",
    fix: "Load every image, script, stylesheet and embed over https:// so nothing on a secure page is blocked.",
    passed: "Everything on the page loads securely",
  },
  "stale-copyright": {
    area: "trust",
    severity: "improve",
    title: "The site looks unmaintained",
    why: "An old year in the footer tells a visitor nobody has touched the site in a while — and makes them wonder whether you are still in business.",
    fix: "Keep the footer year current automatically, and refresh content that is visibly out of date.",
    passed: "The footer looks current",
  },
  "no-viewport": {
    area: "phones",
    severity: "urgent",
    title: "Not built for phones",
    why: "Most visitors arrive on a phone. Without this, they see a shrunken desktop page they have to pinch and zoom — and Google ranks pages that fail on phones lower.",
    fix: "Make every page responsive: add a proper viewport, and check every layout at phone widths (320–430px) with no sideways scrolling and tap targets at least 44px.",
    passed: "Set up for phone screens",
  },
  "zoom-blocked": {
    area: "access",
    severity: "improve",
    title: "Visitors can’t zoom in",
    why: "People who need larger text — many of them older customers — cannot pinch to zoom, so they cannot read you.",
    fix: "Allow pinch-zoom: remove user-scalable=no and maximum-scale limits from the viewport.",
    passed: "Pinch-zoom is allowed",
  },
  noindex: {
    area: "found",
    severity: "urgent",
    title: "Google is told not to list this page",
    why: "The page asks search engines to leave it out, so people searching for you will not find it — usually a leftover from when the site was being built.",
    fix: "Remove the noindex instruction (meta robots and X-Robots-Tag) from pages that should appear in search.",
    passed: "Search engines are allowed to list it",
  },
  "no-title": {
    area: "found",
    severity: "urgent",
    title: "The page has no title",
    why: "The title is the blue headline in Google results and the name on the browser tab. Without one, Google invents something — or skips you.",
    fix: "Give every page a specific title that names the business and what the page offers (roughly 30–60 characters).",
    passed: "Has a page title",
  },
  "weak-title": {
    area: "found",
    severity: "improve",
    title: "The page title doesn’t sell",
    why: "That title is the first thing someone sees in Google. A generic or cut-off one gives them no reason to pick you over the next result.",
    fix: "Rewrite each page title to name the business and what it offers, in roughly 30–60 characters.",
    passed: "The page title is specific",
  },
  "no-description": {
    area: "found",
    severity: "improve",
    title: "No description for search results",
    why: "Google shows a short description under your title. Without one it grabs random text from the page, which rarely makes anyone click.",
    fix: "Write a meta description for every page: one or two sentences (up to ~155 characters) saying what you offer and why to choose you.",
    passed: "Has a search description",
  },
  "no-h1": {
    area: "found",
    severity: "improve",
    title: "No main headline on the page",
    why: "Visitors and search engines both look for the one headline that says what the page is about. There isn’t one.",
    fix: "Give every page one clear main headline (h1) that says what the business does.",
    passed: "Has a main headline",
  },
  "thin-text": {
    area: "found",
    severity: "improve",
    title: "Very little for Google to read",
    why: "As the page arrives, it holds only a few words. Search engines, link previews and slow connections judge you by exactly that — and there is almost nothing to judge.",
    fix: "Put the page’s real content — what you offer, for whom, where and why you — in the HTML the server sends (server rendering or static generation), not only after scripts run.",
    passed: "Has real text to read",
  },

  "no-structured-data": {
    area: "found",
    severity: "improve",
    title: "Google can’t read your business details",
    why: "Structured data lets Google show your opening hours, address, prices or reviews right in the results. Competitors who have it take up more of the page.",
    fix: "Add schema.org structured data (JSON-LD) describing the business — name, address, contact, opening hours and offerings, as applicable.",
    passed: "Business details are machine-readable",
  },
  "no-share-preview": {
    area: "customers",
    severity: "improve",
    title: "Links you share look bare",
    why: "When someone sends your site on WhatsApp, LinkedIn or Facebook, it appears without a picture or a proper title — the moment a recommendation should look its best.",
    fix: "Add Open Graph and Twitter card tags (title, description and a 1200×630 image) so shared links show a proper preview.",
    passed: "Shared links show a preview",
  },
  "no-contact": {
    area: "customers",
    severity: "urgent",
    title: "No way to reach you from this page",
    why: "A visitor who is ready to buy or book finds no phone number, email, form or contact link here. Every one who gives up is a lost enquiry.",
    fix: "Put a clear way to get in touch on every page — a contact or booking button above the fold, plus a tappable phone number or email.",
    passed: "Visitors can reach you from here",
  },
  "phone-not-tappable": {
    area: "customers",
    severity: "improve",
    title: "Your phone number isn’t tappable",
    why: "On a phone, a number that is just text has to be copied and retyped. A tappable one calls you in one touch.",
    fix: "Turn every phone number into a tel: link so it calls in one tap on a phone.",
    passed: "Phone number is tappable",
  },
  slow: {
    area: "speed",
    severity: "improve",
    title: "The page is slow to arrive",
    why: "Every extra second before something appears loses visitors — on a phone connection most people give up after about three.",
    fix: "Make the first page load fast: cache the HTML, compress and resize images, and remove render-blocking scripts. Aim for content in under two seconds on a phone.",
    passed: "The page arrives quickly",
  },
  "heavy-page": {
    area: "speed",
    severity: "improve",
    title: "The page is heavy before a single image loads",
    why: "The page’s code alone is large, which slows every visit and costs your visitors mobile data.",
    fix: "Slim the HTML: remove inlined bulk (base64 images, duplicate scripts, unused builder markup) and load what is left on demand.",
    passed: "The page is light",
  },
  "images-no-alt": {
    area: "access",
    severity: "improve",
    title: "Images have no descriptions",
    why: "Blind visitors hear nothing where your pictures are, and Google Images cannot tell what they show — so they never bring you traffic.",
    fix: "Give every meaningful image a short alt text describing it; mark purely decorative images with empty alt.",
    passed: "Images are described",
  },
  "no-lang": {
    area: "access",
    severity: "improve",
    title: "The page doesn’t say what language it is in",
    why: "Screen readers then read it in the wrong accent, and browsers offer to translate a page that needs no translating.",
    fix: 'Declare the page language on the html element (for example lang="de-CH"), and per page on multilingual sites.',
    passed: "Declares its language",
  },
} as const satisfies Record<string, CheckCopy>;

export type ConsultCheckId = keyof typeof CONSULT_CHECKS;
export const CONSULT_CHECK_IDS = Object.keys(CONSULT_CHECKS) as [
  ConsultCheckId,
  ...ConsultCheckId[],
];

/** What the consultation honestly did — shown under every report. */
export const CONSULT_SCOPE =
  "Loki read this one page the way a browser first receives it — before scripts run, without signing in or filling in forms. It is a first look, not a full audit: the build agent goes deeper.";
