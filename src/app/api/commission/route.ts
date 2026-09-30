import { jsonError } from "@/lib/api/route-helpers";
import { COMMISSION } from "@/config/commission";
/** Compatibility response for old paid-intake clients. Studio requests now belong to Bitbaum. */
export async function POST() {
  return jsonError(
    "Studio requests have moved to Bitbaum. Open the studio website to submit and track your brief.",
    410,
    { studioUrl: `${COMMISSION.studioHireUrl}#website` },
  );
}
