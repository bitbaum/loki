import { permanentRedirect } from "next/navigation";

/**
 * /commission was the old name of /change ("commission" means hiring someone;
 * the page is where you build it yourself). Kept as a redirect so links in
 * docs, the studio's hire page and old shares keep working. A `#brief=` hand-off
 * survives: browsers carry the fragment across a redirect. `?package=` is the
 * studio's own door and is handled on /change.
 */
export default async function CommissionRedirect({
  searchParams,
}: {
  searchParams: Promise<{ package?: string }>;
}) {
  const params = await searchParams;
  permanentRedirect(
    params.package ? `/change?package=${encodeURIComponent(params.package)}` : "/change",
  );
}
