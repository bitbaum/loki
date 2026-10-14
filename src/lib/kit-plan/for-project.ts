/**
 * The kit plan for one project, from what the server holds: its brief, the
 * live package catalogue and whether it starts from the fleet starter.
 *
 * Both readers call this — the kickoff screen (KitPlanPreview) and the first
 * build's dispatch (lib/kickoff/steps.ts) — so what the person is told their
 * site will use is what the agent is told to wire. Never throws: a catalogue
 * that cannot be read is the committed snapshot, and anything worse is "no
 * plan", which leaves the kickoff exactly as it was before plans existed.
 */
import { getBriefKind } from "@/db/queries/brief-projects";
import { isFleetOrgRepo } from "@/lib/fleet-brief/brief";
import { parseGithubRepo } from "@/lib/github-repo-ref";
import { getPackageCatalogue } from "@/lib/packages/catalogue";
import { kitBriefText, starterPackages, startsFromFleetStarter, type KitBriefInput } from "./brief";
import { planKits, type KitPlan } from "./plan";

export type ProjectKitPlan = {
  /** The project starts from the fleet starter in the fleet's org, so a plan applies. */
  applies: boolean;
  plan: KitPlan;
  /** Client work: the build replaces the fleet's tokens with the client's. */
  clientTokens: boolean;
};

const NONE: ProjectKitPlan = {
  applies: false,
  plan: { kits: [], sharedWith: 0 },
  clientTokens: false,
};

export async function kitPlanForProject(
  args: KitBriefInput & {
    name: string;
    entityId: string;
    /** Null before the repository exists — the kickoff creates it in the fleet's org. */
    gitUrl: string | null;
    clientWork: boolean;
  },
): Promise<ProjectKitPlan> {
  try {
    if (args.gitUrl && !isFleetOrgRepo(args.gitUrl)) return NONE;
    const briefKind = await getBriefKind(args.entityId).catch(() => null);
    if (!startsFromFleetStarter({ name: args.name, stack: args.attrs.stack, briefKind })) {
      return NONE;
    }
    const { packages } = await getPackageCatalogue();
    const plan = planKits(kitBriefText(args), packages, {
      starterPackages: starterPackages(),
      selfSlug: (parseGithubRepo(args.gitUrl)?.repo ?? args.name).toLowerCase(),
    });
    return { applies: true, plan, clientTokens: args.clientWork };
  } catch (e) {
    console.error("[kit-plan] planning failed:", e instanceof Error ? e.message : e);
    return NONE;
  }
}
