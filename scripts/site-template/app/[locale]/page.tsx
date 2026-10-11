import { getTranslations, setRequestLocale } from "next-intl/server";
import { button, buttonQuiet, link, shell } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { getSession } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { LOKI_ORIGIN } from "@/lib/security";
import { SITE } from "@/lib/site";

/**
 * The day-zero page. Every product created from the starter serves THIS until
 * its owner replaces it, so it addresses the owner and a first visitor, never a
 * developer. Everything it claims is gated on being true: the "change it from
 * this page" line renders only when the feedback widget does.
 */
const ORANGECAT = "https://orangecat.ch";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const session = await getSession();

  // Written by Loki's new-site.sh at scaffold time; each link degrades rather
  // than rendering /projects/undefined when provisioning could not reach Loki.
  const lokiProject = process.env.NEXT_PUBLIC_FC_PROJECT_ID;
  const ocProject = process.env.NEXT_PUBLIC_OC_PROJECT_ID;
  const buildHref = lokiProject
    ? `${LOKI_ORIGIN}/projects/${lokiProject}`
    : `${LOKI_ORIGIN}/projects`;
  const ocHref = ocProject ? `${ORANGECAT}/projects/${ocProject}` : null;
  const hasWidget = Boolean(process.env.NEXT_PUBLIC_FC_WIDGET_TOKEN);

  return (
    <div className={`${shell} py-16 sm:py-24`}>
      <h1 className="font-display text-display-2 text-fg-primary">{SITE.title}</h1>
      <p className="mt-3 max-w-[28ch] text-2xl text-fg-secondary">{t("waiting")}</p>
      <p className="mt-8 max-w-prose text-lg leading-relaxed text-fg-secondary">{t("lede")}</p>

      <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <a href={buildHref} className={button}>
          {t("build")}
          <span aria-hidden="true">&rarr;</span>
        </a>
        <Link href={session ? ROUTES.account : ROUTES.signUp} className={buttonQuiet}>
          {session ? t("yourAccount") : t("createAccount")}
        </Link>
        {ocHref && (
          <a href={ocHref} className={link}>
            {t("followOnOrangecat")}
          </a>
        )}
      </div>

      <ul className="mt-16 grid gap-6 border-t border-subtle pt-10 sm:grid-cols-3">
        {(["private", "accounts", "languages"] as const).map((key) => (
          <li key={key}>
            <h2 className="text-base font-semibold text-fg-primary">{t(`points.${key}.title`)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
              {t(`points.${key}.body`)}
            </p>
          </li>
        ))}
      </ul>

      {hasWidget && (
        <p className="mt-12 max-w-prose rounded-lg bg-surface-raised px-5 py-4 text-sm leading-relaxed text-fg-secondary">
          {t("widget")}
        </p>
      )}
    </div>
  );
}
