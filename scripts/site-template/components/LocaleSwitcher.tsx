"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { localeNames, routing } from "@/i18n/routing";

/** The same page in another language. Each choice is a real link, so it works without JavaScript. */
export function LocaleSwitcher({ label }: { label: string }) {
  const pathname = usePathname();
  const current = useLocale();
  return (
    <ul aria-label={label} className="flex items-center gap-1">
      {routing.locales.map((locale) => (
        <li key={locale}>
          <Link
            href={pathname}
            locale={locale}
            lang={locale}
            aria-current={locale === current ? "true" : undefined}
            title={localeNames[locale]}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm uppercase text-fg-secondary hover:text-fg-primary aria-[current]:font-semibold aria-[current]:text-fg-primary"
          >
            {locale}
          </Link>
        </li>
      ))}
    </ul>
  );
}
