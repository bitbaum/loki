import Link from "next/link";
import { getPackageScanForProject, listProjectPackages } from "@/db/queries/project-packages";
import { recordObservedIfDue } from "@/lib/kit-plan/record";
import type { KitPlanRecord } from "@/lib/kit-plan/types";

/**
 * The plan beside the observations: which shared packages the first build
 * was told to use that the repository does not have yet. "Built from" above
 * lists only what the lockfile says, because those rows are observations; a
 * plan is not one, so it is its own line here and never a row there.
 *
 * Reading the repository is also when a kickoff's plan gets compared with
 * what the build installed (lib/kit-plan/record.ts), so that happens here too.
 */
export async function ProjectPlannedKits({
  ownerId,
  entityProjectId,
  userProjectId,
  plan,
}: {
  ownerId: string;
  entityProjectId: string;
  userProjectId: string;
  plan: KitPlanRecord | null;
}) {
  if (!plan || plan.kits.length === 0) return null;
  const [scan, rows] = await Promise.all([
    getPackageScanForProject(userProjectId).catch(() => null),
    listProjectPackages(userProjectId).catch(() => []),
  ]);
  const observed = rows.map((row) => row.packageName);
  await recordObservedIfDue({ ownerId, entityProjectId, scan, observed });

  const read = scan?.outcome === "ok" || scan?.outcome === "no-manifest";
  const installed = new Set(observed);
  const waiting = read ? plan.kits.filter((kit) => !installed.has(kit.name)) : plan.kits;

  return (
    <p className="mt-4 text-sm text-text-secondary wrap-anywhere">
      <span className="ui-micro-label mr-2">Planned</span>
      {waiting.length === 0 ? (
        "Everything the build was planned with is in the code."
      ) : (
        <>
          {read ? "Not in the code yet: " : "The build was planned with "}
          {waiting.map((kit, i) => (
            <span key={kit.name}>
              {i > 0 && (i === waiting.length - 1 ? " and " : ", ")}
              <Link href={`/packages/${kit.slug}`} className="ui-link-subtle">
                {kit.plain}
              </Link>
            </span>
          ))}
          {read ? "." : " — this list fills in once Loki reads the code."}
        </>
      )}
    </p>
  );
}
