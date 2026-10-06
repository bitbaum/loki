import type { Metadata } from "next";
import { SignInError } from "@bitbaum/accountkit";
import { ROUTES } from "@/config/auth";

export const metadata: Metadata = { title: "Sign-in did not finish", robots: { index: false } };

/**
 * Where Auth.js sends a sign-in that did not finish (pages.error). It used to
 * be Auth.js's bare "Error" page. Loki signs in several ways, so "Try again"
 * goes back to the sign-in page, which starts whichever one the person picks;
 * the provider's error code is never shown.
 */
export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="min-h-dvh px-4">
      <SignInError
        error={error}
        retry={ROUTES.SIGN_IN}
        home="/"
        labels={{
          kicker: "Sign in to Loki",
          deniedBody: "Your sign-in went through, but Loki could not accept this account.",
          failedBody:
            "Nothing was changed. Start again — it usually works the second time. If it keeps failing, the service you signed in with may be briefly unavailable.",
        }}
      />
    </main>
  );
}
