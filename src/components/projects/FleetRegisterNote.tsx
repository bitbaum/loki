import Link from "next/link";
import { readAppsConf } from "@/lib/register/apps-conf";
import { buildFleetRegister } from "@/lib/register/build";
import { getUserProjects } from "@/db/queries/user-projects";
import { getSelfImprovementTarget } from "@/db/queries/frontier";

/**
 * The Projects page lists Loki projects. The box hosts sites, and the two
 * sets are not the same — a site provisioned by the hosted factory, or one that
 * predates this database, has an address and no project here. That gap is
 * invisible from a page built by reading the projects table, which is exactly
 * why it survived: nothing that could show it was looking.
 *
 * So this line is not a nav link dressed up. It is the count, and it goes to
 * the register where the rows are.
 */
export async function FleetRegisterNote({ userId }: { userId: string }) {
  // apps.conf describes ONE box — the studio's — and is a file in this repo, not
  // per-tenant data. Rendered for everyone it told a brand-new account with zero
  // projects that "19 sites are hosted on the box with no project here", about
  // sites they do not own and cannot see. The gap is only a to-do list for the
  // account that operates that box, so only that account is told about it.
  const owner = await getSelfImprovementTarget();
  if (!owner || owner.userId !== userId) return null;

  let unlinked = 0;
  try {
    const projects = await getUserProjects(userId);
    const rows = buildFleetRegister(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        hostedApp: p.hostedApp,
        gitUrl: p.gitUrl,
        liveUrl: p.liveUrl,
        isActive: p.isActive,
      })),
      readAppsConf(),
    );
    unlinked = rows.filter((r) => r.site && !r.loki).length;
  } catch {
    // A register that cannot be read must not take the page down with it.
    return null;
  }

  return (
    <p className="mt-6 text-sm text-text-tertiary">
      {unlinked > 0
        ? `${unlinked} ${unlinked === 1 ? "site is" : "sites are"} hosted on the box with no project here. `
        : "Every hosted site has a project here. "}
      <Link href="/fleet" className="underline decoration-border-subtle underline-offset-4">
        See the whole register
      </Link>
    </p>
  );
}
