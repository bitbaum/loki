import { NextRequest, NextResponse } from "next/server";
import {
  searchPeople,
  createPerson,
  SORT_MODE,
  type SortMode,
  CreatePersonBody,
} from "@/db/queries/people";
import { type RelationshipHealth, RELATIONSHIP_HEALTH_VALUES } from "@/lib/constants/people";
import { readJsonBody, handleDuplicateEntityNameError } from "@/lib/api/route-helpers";
import { requirePrivateApiAccess } from "@/lib/private-zone-api";

const VALID_SORTS: SortMode[] = Object.values(SORT_MODE);

export async function POST(req: NextRequest) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const { userId } = access;
  const dataOrResp = await readJsonBody(req, CreatePersonBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  try {
    const created = await createPerson(userId, dataOrResp);
    return NextResponse.json({ ok: true, person: created }, { status: 201 });
  } catch (e: unknown) {
    const dup = handleDuplicateEntityNameError(e, "person");
    if (dup) return dup;
    throw e;
  }
}

export async function GET(request: Request) {
  const access = await requirePrivateApiAccess();
  if (access instanceof NextResponse) return access;
  const { userId } = access;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").slice(0, 200);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);
  const sortRaw = searchParams.get("sort") ?? SORT_MODE.RECENT;
  const sort: SortMode = VALID_SORTS.includes(sortRaw as SortMode)
    ? (sortRaw as SortMode)
    : SORT_MODE.RECENT;

  const healthRaw = searchParams.get("health") ?? "";
  const health = healthRaw
    .split(",")
    .map((h) => h.trim())
    .filter((h): h is RelationshipHealth =>
      (RELATIONSHIP_HEALTH_VALUES as readonly string[]).includes(h),
    );

  // The search box: one slip in a name still finds the person, best match first.
  const result = await searchPeople(userId, q, limit, offset, sort, health, {
    forgiveTypos: true,
  });
  return NextResponse.json(result);
}
