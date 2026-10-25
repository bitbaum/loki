import { SiteMasthead, SiteFooter } from "@bitbaum/sitekit/react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { NavLink } from "@/components/NavLink";
import { link } from "@/components/ui";
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
          <SiteMasthead
            appearance="application"
            chrome={{ name: SITE.title, tagline: nav("beta"), footerNote: footer("note") }}
            navItems={[]}
            currentPath=""
            mainId="main"
            skipLabel={nav("skip")}
            Link={Link}
            brand={
              <>
                {SITE.title}
                <span className="text-xs font-normal text-fg-secondary">{nav("beta")}</span>
              </>
            }
            actions={
              <>
                <NavLink href={session ? ROUTES.account : ROUTES.signIn} className={link}>
                  {session ? nav("account") : nav("signIn")}
                </NavLink>
                <LocaleSwitcher label={nav("language")} />
              </>
            }
          />

          <main id="main" className="flex-1">
            {children}
          </main>

          <SiteFooter
            appearance="application"
            chrome={{ name: SITE.title, tagline: nav("beta"), footerNote: footer("note") }}
            Link={Link}
            label={footer("label")}
            links={[
              { href: ROUTES.blog, label: footer("journal") },
              { href: ROUTES.roadmap, label: footer("roadmap") },
              { href: ROUTES.changelog, label: footer("changelog") },
              { href: SITE.repo, label: footer("source") },
            ]}
          />
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
