import { DevelopmentPage } from "bip-kit/react";
import { getTranslations } from "next-intl/server";
import { link, notice, shell } from "@/components/ui";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { loadDevelopment } from "@/lib/fleet";
import { ROUTES } from "@/lib/routes";
import { FLEET_PROFILE_URL, SITE } from "@/lib/site";

const LABELS = [
  "roadmap",
  "changelog",
  "home",
  "profile",
  "beta",
  "source",
  "unavailable",
  "emptyRoadmap",
  "emptyChangelog",
  "progress",
  "target",
] as const;

/**
 * The roadmap or the changelog: bip-kit's renderer over the fleet map's copy
 * of this repository's ROADMAP.md / CHANGELOG.md (lib/fleet.ts). Labels are
 * translated; the records are the operator's own words, left as written.
 *
 * When the map has nothing for this product, the page still leads somewhere:
 * the file itself, on GitHub.
 */
export async function DevelopmentRecords({
  section,
  locale,
}: {
  section: "roadmap" | "changelog";
  locale: Locale;
}) {
  const t = await getTranslations("Records");
  const development = await loadDevelopment();
  const at = (href: string) => getPathname({ href, locale });
  const file = section === "roadmap" ? "ROADMAP.md" : "CHANGELOG.md";

  return (
    <div className={`${shell} py-10 sm:py-14`}>
      <p className="mb-6 text-sm text-fg-secondary">{t("englishOnly")}</p>
      <DevelopmentPage
        profile={development}
        section={section}
        homeHref={at(ROUTES.home)}
        roadmapHref={at(ROUTES.roadmap)}
        changelogHref={at(ROUTES.changelog)}
        profileHref={FLEET_PROFILE_URL}
        labels={Object.fromEntries(LABELS.map((key) => [key, t(key)]))}
      />
      {!development && (
        <p className={`${notice} mt-8`}>
          {t("readFile")}{" "}
          <a href={`${SITE.repo}/blob/main/${file}`} className={link}>
            {file}
          </a>
        </p>
      )}
    </div>
  );
}
