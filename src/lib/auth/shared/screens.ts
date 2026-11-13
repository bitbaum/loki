/**
 * What AccountKit's own screens offer on this deployment (server only): every
 * way in the shared runtime mounts, computed from the same env and options as
 * src/lib/auth/shared/runtime.ts, so a button never appears for a method the
 * server does not serve. Null on Auth.js (AUTH_RUNTIME unset), where Loki's
 * own forms still answer.
 */
import { isMailConfigured } from "@bitbaum/mail-kit";
import { signInMethods, type SignInMethods } from "@bitbaum/accountkit/auth";
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";
import { LOKI_GITHUB_SIGN_IN } from "./runtime-options";

export function accountKitMethods(env: NodeJS.ProcessEnv = process.env): SignInMethods | null {
  if (!sharedRuntimeEnabled(env)) return null;
  return offerGithubOnce(
    signInMethods(env, isMailConfigured(env), { githubSignIn: LOKI_GITHUB_SIGN_IN }),
  );
}

/**
 * GitHub through one door only. With Loki's own GitHub app mounted, the
 * shared sign-in's button also named GitHub, so the first screen read
 * "Continue with Google or GitHub" and then "Continue with GitHub": two doors
 * to the same place, and no way to tell whether they lead to one account
 * (2026-11-12). Loki's own button stays (it carries the repository grant);
 * the shared button's label names the rest. Only the label changes: the
 * shared service's own chooser still offers GitHub, so anyone whose account
 * came in that way still reaches it. When GitHub is all the shared service
 * publishes, nothing changes (hiding that button could strand those accounts).
 * Belongs in @bitbaum/accountkit's signInMethods for every product that keeps
 * its own GitHub app.
 */
export function offerGithubOnce(methods: SignInMethods): SignInMethods {
  if (!methods.github || !methods.signinProviders?.length) return methods;
  const rest = methods.signinProviders.filter((name) => name.toLowerCase() !== "github");
  if (rest.length === 0 || rest.length === methods.signinProviders.length) return methods;
  return { ...methods, signinProviders: rest };
}
