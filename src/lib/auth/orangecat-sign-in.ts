/**
 * How Loki hands a person to OrangeCat, by intent.
 *
 * OrangeCat is the identity root (ADR-0009 there: one account for every
 * door), so "Create an account" on Loki's sign-up page is OrangeCat's own
 * create-account screen, not a password form here. OIDC Prompt Create
 * (`prompt=create`) is what asks OrangeCat to open in that state; it is
 * advertised in its discovery document (`prompt_values_supported`).
 *
 * Pure so the sign-up and sign-in buttons cannot disagree about it.
 */
export type OrangeCatIntent = "sign-in" | "sign-up";

/** Extra authorization parameters for `signIn("orangecat", …, params)`. */
export function orangecatAuthorizationParams(
  intent: OrangeCatIntent,
): Record<string, string> | undefined {
  return intent === "sign-up" ? { prompt: "create" } : undefined;
}

/** The button's label — says what will happen, not which protocol does it. */
export function orangecatButtonLabel(intent: OrangeCatIntent): string {
  return intent === "sign-up" ? "Create an account with OrangeCat" : "Continue with OrangeCat";
}
