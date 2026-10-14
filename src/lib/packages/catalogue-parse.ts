/**
 * The fleet's shared-package catalogue, read from bitbaum/fleet
 * `registers/packages.json` into the fields Loki's Packages pages show.
 *
 * ONE FETCH. The fleet brief (src/lib/fleet-brief/brief.ts) already fetches
 * that file — live, cached, with a committed snapshot to fall back on — and
 * reduces it to the three fields a prompt may carry. This parser reads the
 * SAME body into the richer shape a page needs (slug, repository, version,
 * who adopted it); brief.ts runs both parsers over one response, and
 * ./catalogue.ts serves the result. A second fetch of the same register would
 * be a second cache that can disagree with the first.
 *
 * Nothing here names a package. The list is whatever fleet says it is; a
 * package fleet has not registered yet is simply not in it, and every reader
 * of the catalogue has to cope with that.
 *
 * Pure: no network, no database.
 */
import { z } from "zod";
import { capText, flattenText, INSTALL_RE, PACKAGE_NAME_RE } from "@/lib/fleet-brief/parse";
import { parseGithubRepo } from "@/lib/github-repo-ref";

export type CatalogueSource = "npm" | "git";

export type CataloguePackage = {
  /** Stable id, used in the URL: `/packages/<slug>`. */
  slug: string;
  /** npm name, e.g. `@bitbaum/ai-kit`. */
  name: string;
  /** `owner/repo` of the package's own repository, when the register names one on GitHub. */
  repo: string | null;
  /** One line, for a list row. */
  summary: string | null;
  /** The register's description, flattened and capped, for the package's own page. */
  description: string | null;
  /** The version the register last saw in the package's repository. */
  registerVersion: string | null;
  /** How the register says to install it. */
  installSource: CatalogueSource | null;
  /** A validated `pnpm add …` command, or null when the register's did not validate. */
  install: string | null;
  /** Which fleet repositories the register counted as adopters. */
  adopterNames: string[];
};

export const CATALOGUE_LIMITS = {
  packages: 200,
  summaryChars: 140,
  descriptionChars: 900,
  adopters: 200,
} as const;

/** What a package slug may look like — also what a `/packages/[slug]` route accepts. */
export const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const VERSION_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const Row = z.object({
  slug: z.string().optional(),
  name: z.string().regex(PACKAGE_NAME_RE),
  repo: z.string().max(300).nullable().optional(),
  description: z.string().max(8000).nullable().optional(),
  version: z.string().max(60).nullable().optional(),
  install: z
    .object({ source: z.string().max(20).optional(), command: z.string().max(200) })
    .optional(),
  adopterNames: z.array(z.string().max(100)).max(1000).optional(),
});

const Register = z.object({ packages: z.array(z.unknown()).max(1000) });

/** `@bitbaum/ai-kit` → `ai-kit`. */
function slugFromName(name: string): string {
  return name.replace(/^@[^/]+\//, "");
}

function firstSentence(text: string): string {
  const m = /^(.+?[.!?])\s+(?=\S)/.exec(text);
  return (m ? m[1] : text).replace(/\.$/, "");
}

/** `registers/packages.json` → the catalogue, or null when it is unusable. */
export function parseCatalogue(json: unknown): CataloguePackage[] | null {
  const register = Register.safeParse(json);
  if (!register.success) return null;
  const out: CataloguePackage[] = [];
  const seen = new Set<string>();
  for (const raw of register.data.packages) {
    const row = Row.safeParse(raw);
    if (!row.success) continue;
    const r = row.data;
    const slug = r.slug && SLUG_RE.test(r.slug) ? r.slug : slugFromName(r.name);
    if (!SLUG_RE.test(slug) || seen.has(slug) || seen.has(r.name)) continue;
    seen.add(slug);
    seen.add(r.name);
    const text = r.description ? flattenText(r.description) : "";
    const command = r.install?.command.trim().replace(/\s+/g, " ") ?? "";
    const source = r.install?.source;
    out.push({
      slug,
      name: r.name,
      repo: parseGithubRepo(r.repo)?.slug ?? null,
      summary: text ? capText(firstSentence(text), CATALOGUE_LIMITS.summaryChars) : null,
      description: text ? capText(text, CATALOGUE_LIMITS.descriptionChars) : null,
      registerVersion: r.version && VERSION_RE.test(r.version) ? r.version : null,
      installSource: source === "npm" || source === "git" ? source : null,
      install: INSTALL_RE.test(command) ? command : null,
      adopterNames: (r.adopterNames ?? [])
        .map((n) => flattenText(n))
        .filter((n) => SLUG_RE.test(n))
        .slice(0, CATALOGUE_LIMITS.adopters),
    });
    if (out.length >= CATALOGUE_LIMITS.packages) break;
  }
  return out.length > 0 ? out : null;
}

/** The committed fallback's shape for the catalogue half of the snapshot. */
export const CatalogueSnapshot = z
  .array(
    z.object({
      slug: z.string().regex(SLUG_RE),
      name: z.string().regex(PACKAGE_NAME_RE),
      repo: z.string().max(200).nullable(),
      summary: z.string().max(CATALOGUE_LIMITS.summaryChars).nullable(),
      description: z.string().max(CATALOGUE_LIMITS.descriptionChars).nullable(),
      registerVersion: z.string().regex(VERSION_RE).nullable(),
      installSource: z.enum(["npm", "git"]).nullable(),
      install: z.string().regex(INSTALL_RE).nullable(),
      adopterNames: z.array(z.string().regex(SLUG_RE)).max(CATALOGUE_LIMITS.adopters),
    }),
  )
  .max(CATALOGUE_LIMITS.packages);
