/**
 * Did a `signIn(..., { redirect: false })` call sign the person in?
 *
 * Auth.js answers a refused sign-in with HTTP 200 and the reason in `error`,
 * so `ok` is true either way. Testing `ok` alone sent a wrong password on to
 * the app (which bounced it back to /sign-in) and "Incorrect email or
 * password." could never be drawn: the form said nothing at all.
 */
export function signInSucceeded(
  res: { ok?: boolean; error?: string | null } | null | undefined,
): boolean {
  return Boolean(res?.ok && !res.error);
}
