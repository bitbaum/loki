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
  return signInMethods(env, isMailConfigured(env), { githubSignIn: LOKI_GITHUB_SIGN_IN });
}
