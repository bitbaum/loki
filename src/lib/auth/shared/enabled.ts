/**
 * Whether the staged AccountKit runtime answers (AUTH_RUNTIME=accountkit).
 * Auth.js answers otherwise. Its own module, free of the database, so the
 * proxy and the provider gates can ask without loading the runtime.
 */
export function sharedAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_RUNTIME === "accountkit";
}
