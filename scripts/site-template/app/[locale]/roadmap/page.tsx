import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DevelopmentRecords } from "@/components/DevelopmentRecords";
import { toLocale } from "@/i18n/routing";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getTranslations({
    locale: toLocale((await params).locale),
    namespace: "Records",
  });
  return { title: t("roadmap") };
}

export default async function RoadmapPage({ params }: Params) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  return <DevelopmentRecords section="roadmap" locale={locale} />;
}
