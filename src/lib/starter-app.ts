// The Next.js starter a kickoff seeds — the SAME app new-site.sh scaffolds,
// because both come from scripts/site-template, which is bitbaum/fleet
// templates/app at the commit pinned in scripts/site-template/.fleet-source
// (scripts/templates/sync-starter.sh is the only way it changes).
//
// The file bodies are not written here: they are generated from that directory
// into starter-app.generated.ts, and scripts/test/starter-app.ts fails when the
// two differ. Server-only — the map is ~0.5 MB and must never reach a client
// bundle (pickers import src/config/project-templates.ts instead).
import { sitesBaseDomain, siteCdSlug, workflowOwner } from "@/lib/site-cd";
import { STARTER_APP_FILES, STARTER_APP_SOURCE } from "@/lib/starter-app.generated";

export { STARTER_APP_SOURCE };

/** Workflows need the `workflow` OAuth scope, which a kickoff token may lack —
 *  and a tree commit with one unwritable path writes nothing. register-site.sh
 *  adds them (Contents API, the host identity) when the site gets its CD. */
const LEFT_TO_REGISTER = ".github/workflows/";

/** The starter ships `gitignore` without its dot; a repo needs `.gitignore`. */
const RENAMES: Readonly<Record<string, string>> = { gitignore: ".gitignore" };

export function starterSeedFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, body] of Object.entries(STARTER_APP_FILES)) {
    if (path.startsWith(LEFT_TO_REGISTER)) continue;
    out[RENAMES[path] ?? path] = body;
  }
  return out;
}

export interface StarterValues {
  slug: string;
  title: string;
  host: string;
  owner: string;
}

/**
 * A project name as the starter's display title. The title lands inside
 * TypeScript string literals and Markdown, so the characters that could end a
 * literal or open markup are dropped — the same set fleet's render-app.sh
 * refuses (it can refuse; a kickoff has to proceed).
 */
export function starterTitle(name: string): string {
  return name
    .replace(/[\p{Cc}"\\`$<>|&]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** The values a kickoff fills in, from the project and the repo it created. */
export function starterValues(input: { name: string; owner: string; repo: string }): StarterValues {
  const slug = siteCdSlug(input.name) || siteCdSlug(input.repo);
  return {
    slug,
    title: starterTitle(input.name) || slug,
    host: `${slug}.${sitesBaseDomain()}`,
    owner: input.owner || workflowOwner(),
  };
}

const PLACEHOLDERS = /__(SLUG|TITLE|HOST|WORKFLOW_OWNER)__/g;

export function renderStarterFile(body: string, values: StarterValues): string {
  const by: Record<string, string> = {
    SLUG: values.slug,
    TITLE: values.title,
    HOST: values.host,
    WORKFLOW_OWNER: values.owner,
  };
  return body.replace(PLACEHOLDERS, (whole, key: string) => by[key] ?? whole);
}

/** The feedback widget's env for the first build: the token is public by
 *  design (it is printed into every page), so it may live in the repo. */
export function widgetEnvFile(token: string): string {
  return `# Written by Loki at kickoff: the feedback widget for this project.\nNEXT_PUBLIC_FC_WIDGET_TOKEN=${token}\n`;
}
