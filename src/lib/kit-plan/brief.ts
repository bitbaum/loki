/**
 * What the plan reads, and when a plan applies at all.
 *
 * The brief is what the kickoff itself briefs the agent from: the project's
 * description (with the owner's interview answers appended), the profile
 * fields that say what the site DOES, and the milestones. Fields about the
 * market (competitors, alternatives, go-to-market) are left out on purpose —
 * "our competitor has a chat" is not a request for one.
 *
 * Pure: no network, no database. The starter's dependencies are read from the
 * generated starter (src/lib/starter-app.generated.ts), so "already in the
 * starter" can never disagree with what the kickoff actually seeds.
 */
import { inferProvisionTemplate } from "@/config/project-templates";
import { PROJECT_ATTR } from "@/config/project-attrs";
import { answer, cleanDescription } from "@/lib/project-display";
import { isRepoCopyProject } from "@/lib/repo-brief";
import { STARTER_APP_FILES } from "@/lib/starter-app.generated";

/** Profile fields that describe what the site does. */
export const KIT_BRIEF_FIELDS = [
  PROJECT_ATTR.MISSION,
  PROJECT_ATTR.CUSTOMERS,
  PROJECT_ATTR.PROBLEM,
  PROJECT_ATTR.SOLUTION,
  PROJECT_ATTR.STACK,
  PROJECT_ATTR.ARCHITECTURE,
  PROJECT_ATTR.DEFINITION_OF_DONE,
] as const;

export type KitBriefInput = {
  description: string | null | undefined;
  attrs: Record<string, string | undefined>;
  goals?: ReadonlyArray<{ title: string; description?: string | null }>;
};

export function kitBriefText(input: KitBriefInput): string {
  return [
    cleanDescription(input.description),
    ...KIT_BRIEF_FIELDS.map((field) => answer(input.attrs[field])),
    ...(input.goals ?? []).flatMap((goal) => [goal.title, goal.description ?? null]),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}

let starterDeps: ReadonlySet<string> | null = null;

/** Every dependency the fleet starter's package.json declares. */
export function starterPackages(): ReadonlySet<string> {
  if (starterDeps) return starterDeps;
  try {
    const pkg = JSON.parse(STARTER_APP_FILES["package.json"] ?? "{}") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    starterDeps = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    starterDeps = new Set();
  }
  return starterDeps;
}

/**
 * Does this project start from the fleet starter — the Next.js app whose
 * package.json the plan's install lines extend? The same choice the kickoff's
 * provision step makes: "auto" infers the starter from the stack, and a copy
 * of an open-source repository brings its own code.
 */
export function startsFromFleetStarter(args: {
  name: string;
  stack: string | null | undefined;
  briefKind?: string | null;
}): boolean {
  if (isRepoCopyProject(args.name, args.briefKind)) return false;
  return inferProvisionTemplate(answer(args.stack)) === "nextjs-tailwind";
}
