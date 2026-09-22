import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";
import { getProjectsByOrangeCatEntity } from "@/db/queries/orangecat-links";
import { canonicalSlug, repoFromGitUrl } from "@/lib/register/build";
import { publicProfilePath } from "@/lib/register/map";
import { APP_URL } from "@/config/brand";

/**
 * GET /api/orangecat/project-link?project_id=<orangecat project uuid>
 *
 * "Is this OrangeCat project already being built in Loki, and where can a
 * reader see that?"
 *
 * WHY IT EXISTS
 * OrangeCat's project page offers "Build it with Loki" to the owner — and it
 * offered exactly that to projects that had been building in Loki for months,
 * because nothing on that page could tell the difference. The click itself has
 * always been safe (Loki's handoff screen flags an already-linked project
 * rather than creating a second one), but the CARD was addressing a stranger:
 * one click away from work already done.
 *
 * It also answers the question the owner is not the most interested party in.
 * A funder looking at a public project page wants to know that there is a
 * build record at all — dated evidence of work, the half of a transparency
 * claim that better copy cannot manufacture. That link never existed.
 *
 * PUBLIC, AND ONLY EVER PUBLIC
 * `linked: true` requires the Loki project to have consented to public listing
 * (`listed_publicly`), because everything this route returns is then already
 * served at /fleet and /fleet/<slug> to anyone who asks. A project without
 * that consent answers exactly as an unknown id does — `{ linked: false }` —
 * so this route cannot be used to discover that a private project exists.
 *
 * The consequence is deliberate and worth stating: for an unlisted project
 * OrangeCat keeps saying "Build it with Loki". That is a worse label, not a
 * broken path — the handoff still lands on the existing project.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id")?.trim() ?? "";
  // Validate before the query: an id-shaped parameter is the only thing this
  // route can answer, and a malformed one is a caller bug, not a 404.
  if (!UUID.test(projectId)) {
    return NextResponse.json({ error: "project_id must be a UUID" }, { status: 400 });
  }

  // TWO places record the same fact, so both are asked.
  //
  // `orangecat_entity_links` is the general one (any entity type, a role, a
  // title). `user_projects.orangecat_project_id` is the legacy single-UUID
  // column that predates it and is still written by every publish for the
  // funding read path. They normally agree — but measured on prod the day this
  // shipped, one of nine published projects had the column and no link row,
  // and it was Loki's own. Asking only the newer table answered "not linked"
  // for a project that has been building in public for months, which is the
  // exact wrong answer this route exists to stop giving.
  const [linked, legacy] = await Promise.all([
    getProjectsByOrangeCatEntity("project", projectId),
    db.select().from(userProjects).where(eq(userProjects.orangecatProjectId, projectId)).limit(5),
  ]);

  // The first CONSENTING project wins. More than one Loki project can point at
  // one OrangeCat entity (a repointed origin leaves the old link behind); a
  // reader needs one destination, and an unlisted row must not shadow a listed
  // one by happening to sort first.
  const match =
    linked.find((r) => r.project.listedPublicly)?.project ?? legacy.find((p) => p.listedPublicly);

  if (!match) {
    return NextResponse.json(
      { linked: false },
      { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" } },
    );
  }

  const slug = canonicalSlug(match.slug || repoFromGitUrl(match.gitUrl) || match.name);

  return NextResponse.json(
    {
      linked: true,
      name: match.name,
      // The reader's destination — purpose, roadmap, changelog, what moved
      // last. Never the workspace: that is behind a sign-in, and this answer
      // is served to anyone.
      profileUrl: slug ? new URL(publicProfilePath(slug), APP_URL).toString() : null,
    },
    { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" } },
  );
}
