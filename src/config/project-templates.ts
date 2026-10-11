/**
 * Starter templates — SSOT for the *light* half of a template: its id, how it
 * reads in a picker, and the stack keywords that let us choose one without
 * asking. `lib/project-templates.ts` owns the heavy half (the seeded file
 * bodies and the first-task prompt) and composes the two into TEMPLATES.
 *
 * Split this way for two reasons. One, the list existed three times (the
 * provision route's zod enum, the ProjectProvision picker, the lib registry)
 * and could drift. Two, a picker should not have to pull 600 lines of template
 * file contents into a client bundle just to render five labels.
 *
 * The keywords exist so kickoff can pick a starter FROM the project's own
 * stack. A cold-start flow that stops to ask "which starter?" has already lost:
 * the profile it just filled in already says what this is built with.
 *
 * TWO PATHS, ONE APP for "nextjs-tailwind":
 * - Kickoff / GitHub provision seeds these TEMPLATES → agent-ready code repo.
 * - Live Hetzner site + CD uses `scripts/hetzner/new-site.sh` +
 *   `scripts/site-template` (apps.conf, deploy.yml → selfhost-deploy, secrets).
 * Both produce bitbaum/fleet templates/app (src/lib/starter-app.ts). The
 * kickoff omits the workflows; registering a live URL (register-site.sh) adds
 * them, the CD shim included, rather than Create repo implying a deploy.
 */

export const PROVISION_TEMPLATES = [
  {
    id: "nextjs-tailwind",
    label: "Next.js 16 — the bitbaum starter",
    description:
      "The fleet starter: accounts (password, link, passkey, 2FA, OrangeCat), English/German/French, strict security headers, Postgres, tests and CI. Deploys to *.orangecat.ch.",
    keywords: ["next.js", "nextjs", "react", "tailwind", "vercel", "shadcn"],
  },
  {
    id: "python-fastapi",
    label: "Python + FastAPI (uv)",
    description: "Async API in Python. uv handles deps. `uv run uvicorn src.main:app --reload`.",
    keywords: ["python", "fastapi", "django", "flask", "pydantic", "uvicorn"],
  },
  {
    id: "hono-cloudflare",
    label: "Hono + Cloudflare Workers",
    description: "Edge-serverless TypeScript. 100k free requests/day, ms-scale cold starts.",
    keywords: ["hono", "cloudflare", "workers", "wrangler", "edge runtime"],
  },
  {
    id: "html-tailwind",
    label: "Plain HTML + Tailwind (no build)",
    description: "One HTML file. Open in a browser. Perfect for a landing page or quick demo.",
    keywords: ["static site", "static html", "plain html", "jekyll", "hugo", "astro"],
  },
  {
    id: "bare",
    label: "Empty (just a README)",
    description: "Just a README. Bring your own stack.",
    keywords: [],
  },
] as const;

export type ProvisionTemplateId = (typeof PROVISION_TEMPLATES)[number]["id"];

/** Tuple form for zod enums — same list, no second declaration to drift. */
export const PROVISION_TEMPLATE_IDS = PROVISION_TEMPLATES.map((t) => t.id) as unknown as [
  ProvisionTemplateId,
  ...ProvisionTemplateId[],
];

export const DEFAULT_PROVISION_TEMPLATE: ProvisionTemplateId = "nextjs-tailwind";

/**
 * Pick the starter that best matches a project's stack text. Scores by how many
 * of a template's keywords appear, so "Python, FastAPI, React dashboard" lands
 * on the backend starter rather than on whichever keyword happened to come
 * first. No match (or no stack recorded yet) falls back to the web starter.
 */
export function inferProvisionTemplate(stack: string | null | undefined): ProvisionTemplateId {
  const text = (stack ?? "").toLowerCase();
  if (!text.trim()) return DEFAULT_PROVISION_TEMPLATE;

  let best: { id: ProvisionTemplateId; score: number } | null = null;
  for (const template of PROVISION_TEMPLATES) {
    const score = template.keywords.filter((keyword) => text.includes(keyword)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: template.id, score };
  }
  return best?.id ?? DEFAULT_PROVISION_TEMPLATE;
}
