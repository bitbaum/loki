import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { NavLink } from "@/components/NavLink";
import { link, shell } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { routing, toLocale } from "@/i18n/routing";
import { getSession } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { LOKI_ORIGIN } from "@/lib/security";
import { SITE } from "@/lib/site";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: toLocale(locale), namespace: "Meta" });
  return {
    metadataBase: new URL(SITE.url),
    title: { default: SITE.title, template: `%s · ${SITE.title}` },
    description: t("description", { site: SITE.title }),
    openGraph: { siteName: SITE.title, type: "website" },
    alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])) },
    // Nothing behind sign-in belongs in a search index; public pages opt in.
    robots: { index: true, follow: true },
  };
}

/** Sets the tokens' `.dark` class before the first paint, so there is no flash. */
const THEME_SCRIPT =
  "try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}";

/**
 * Deliberately bare: no analytics, no third-party script, no structured data
 * belonging to anyone else. The Loki feedback widget is the one exception, and
 * only when this deployment turns it on.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Set by proxy.ts. Reading it renders every page per request, which a nonce
  // needs: a nonce baked into a static page is no nonce at all.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const nav = await getTranslations("Nav");
  const footer = await getTranslations("Footer");
  const session = await getSession();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-surface-page text-fg-primary">
        <NextIntlClientProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2"
          >
            {nav("skip")}
          </a>
          <header className="border-b border-subtle">
            <div className={`${shell} flex flex-wrap items-center justify-between gap-x-6 py-2`}>
              <Link
                href={ROUTES.home}
                className="inline-flex min-h-11 items-center gap-2.5 text-lg font-semibold"
              >
                {SITE.title}
                {/* Fleet AGENTS.md: nothing is "Live". Served and unfinished says so. */}
                <span className="rounded-md border border-subtle px-1.5 py-0.5 font-mono text-[0.625rem] font-normal uppercase tracking-caps text-fg-secondary">
                  {nav("beta")}
                </span>
              </Link>
              <nav aria-label={nav("label")} className="flex items-center gap-x-4">
                <NavLink href={session ? ROUTES.account : ROUTES.signIn} className={link}>
                  {session ? nav("account") : nav("signIn")}
                </NavLink>
                <LocaleSwitcher label={nav("language")} />
              </nav>
            </div>
          </header>

          <main id="main" className="flex-1">
            {children}
          </main>

          <footer className="mt-20 border-t border-subtle">
            <nav
              aria-label={footer("label")}
              className={`${shell} flex flex-wrap gap-x-6 py-6 text-sm`}
            >
              <NavLink href={ROUTES.roadmap} className={link}>
                {footer("roadmap")}
              </NavLink>
              <NavLink href={ROUTES.changelog} className={link}>
                {footer("changelog")}
              </NavLink>
              <a href={SITE.repo} className={link}>
                {footer("source")}
              </a>
            </nav>
          </footer>
        </NextIntlClientProvider>

        {process.env.NEXT_PUBLIC_FC_WIDGET_TOKEN && (
          <Script
            src={`${LOKI_ORIGIN}/widget.js`}
            strategy="afterInteractive"
            nonce={nonce}
            data-fc-project={process.env.NEXT_PUBLIC_FC_WIDGET_TOKEN}
          />
        )}
      </body>
    </html>
  );
}
