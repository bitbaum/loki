import type { MetadataRoute } from "next";
import { APP_URL } from "@/config/brand";
import { listThoughts } from "@/lib/thoughts-content";
import { getDefaultUser } from "@/db/queries/users";
import { publicPagePaths } from "@/lib/public-pages";

// Next.js file-convention sitemap. Covers:
//   - Every public page: the ones the public nav links (read from PUBLIC_NAV,
//     so a page added to the nav cannot be forgotten here) plus the few the
//     nav does not carry (footer and legal pages). It listed 5 of ~25 until
//     2026-10-01, so /pricing, /docs and /download were invisible to crawlers.
//   - Each filesystem-backed essay (listThoughts)
//   - The default user's public profile (the single canonical site-owner)
//
// Other users' /u/[username] URLs stay OUT — in a multi-tenant deployment a
// public sitemap enumerating every account is a privacy leak. Site owner is
// the only intentional public profile.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const thoughts = listThoughts();
  let defaultUser: Awaited<ReturnType<typeof getDefaultUser>> | undefined;
  try {
    defaultUser = await getDefaultUser();
  } catch {
    // Build/CI may run without a reachable DB — static routes still ship.
  }

  const base: MetadataRoute.Sitemap = [
    { url: `${APP_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    ...publicPagePaths().map((path) => ({
      url: `${APP_URL}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    { url: `${APP_URL}/sign-up`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
    { url: `${APP_URL}/sign-in`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    ...thoughts.map((t) => ({
      url: `${APP_URL}/thoughts/${t.slug}`,
      lastModified: t.publishedAt ? new Date(t.publishedAt) : now,
      changeFrequency: "yearly" as const,
      priority: 0.7,
    })),
  ];

  if (defaultUser?.username) {
    base.push({
      url: `${APP_URL}/u/${defaultUser.username}`,
      lastModified: defaultUser.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  return base;
}
