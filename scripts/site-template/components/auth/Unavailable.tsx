import { getTranslations } from "next-intl/server";
import { buttonQuiet, notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/routes";

/** Accounts are not switched on for this deployment. Says so, and leads somewhere. */
export async function AccountsUnavailable() {
  const t = await getTranslations("Auth");
  return (
    <div className="grid gap-4">
      <p className={notice} role="status">
        {t("unavailable")}
      </p>
      <Link href={ROUTES.home} className={buttonQuiet}>
        {t("backHome")}
      </Link>
    </div>
  );
}
