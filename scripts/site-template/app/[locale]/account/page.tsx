import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccountPanel } from "@/components/auth/AccountPanel";
import { OwnModelSettings } from "@/components/OwnModelSettings";
import { shell } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { isDeliverable, signInMethods } from "@/lib/auth/methods";
import { getAuth } from "@/lib/auth/server";
import { getSession } from "@/lib/auth/session";
import { mailConfigured } from "@/lib/mail";
import { ROUTES } from "@/lib/routes";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: toLocale((await params).locale),
    namespace: "Account",
  });
  return { title: t("title"), robots: { index: false } };
}

/** Everything about one's own account, and the way out of it. */
export default async function AccountPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("Account");
  const session = await getSession();
  if (!session) {
    return redirect({
      href: `${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.account)}`,
      locale,
    });
  }

  const accounts = await getAuth()
    .api.listUserAccounts({ headers: await headers() })
    .catch(() => []);
  const user = session.user as typeof session.user & {
    role?: string;
    twoFactorEnabled?: boolean | null;
  };

  return (
    <div className={`${shell} grid gap-8 py-12 sm:py-16`}>
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <AccountPanel
        user={{
          name: user.name ?? "",
          email: isDeliverable(user.email) ? user.email : null,
          emailVerified: Boolean(user.emailVerified),
          role: user.role ?? "customer",
          twoFactorEnabled: Boolean(user.twoFactorEnabled),
        }}
        linked={accounts.map((a) => a.providerId)}
        methods={signInMethods(process.env, mailConfigured())}
        accountPath={`/${locale}${ROUTES.account}`}
        homePath={`/${locale}`}
      />
      <OwnModelSettings />
    </div>
  );
}
