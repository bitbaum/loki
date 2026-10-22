import { Server } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { readAppsConf } from "@/lib/register/apps-conf";
import { buildFleetRegister } from "@/lib/register/build";
import { registerInput } from "@/lib/register/project-input";
import { getUserProjects } from "@/db/queries/user-projects";
import { getSelfImprovementTarget } from "@/db/queries/frontier";

/**
 * The Projects page lists Loki projects. The studio's server hosts sites, and
 * the two sets are not the same — a site provisioned by the hosted factory, or
 * one that predates this database, has an address and no project here. That
 * gap is invisible from a page built by reading the projects table, which is
 * exactly why it survived: nothing that could show it was looking.
 *
 * So the list ends on one row that counts them and opens the register.
 */
export async function FleetRegisterNote({ userId }: { userId: string }) {
  // apps.conf describes ONE server — the studio's — and is a file in this repo,
  // not per-tenant data. Rendered for everyone it told a brand-new account with
  // zero projects about sites they do not own and cannot see. The gap is only
  // a to-do list for the account that operates that server, so only that
  // account is told about it.
  const owner = await getSelfImprovementTarget();
  if (!owner || owner.userId !== userId) return null;

  let unlinked = 0;
  try {
    const projects = await getUserProjects(userId);
    // The operator's own count: client work they have not published is still
    // a site that needs a project, so nothing is filtered out here.
    const rows = buildFleetRegister(projects.map(registerInput), readAppsConf(), undefined, {
      audience: "operator",
    });
    unlinked = rows.filter((r) => r.site && !r.loki).length;
  } catch {
    // A register that cannot be read must not take the page down with it.
    return null;
  }

  return (
    <List aria-label="Every hosted site">
      <ListRow
        href="/fleet"
        icon={Server}
        title="Every hosted site"
        secondary={
          unlinked > 0
            ? `${unlinked} ${unlinked === 1 ? "site has" : "sites have"} no project here`
            : "Each one has a project here"
        }
        chevron
      />
    </List>
  );
}
