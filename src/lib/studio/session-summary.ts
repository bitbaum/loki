import { ROUTES } from "@/config/auth";

/** What the studio site may know about the person looking at it. */
export interface StudioSessionSummary {
  signedIn: boolean;
  /** Where the site's own controls lead; Loki's addresses are Loki's to state. */
  links: {
    /** Sign in, then back to the page of the studio site named by `to`. */
    signIn: string;
    /** Sign out, then back to the studio site. */
    signOut: string;
    /** A builder's applications, opened by their account. */
    builder: string;
    /** The studio's own requests, for whoever runs the studio. */
    review: string;
    /** Loki itself. */
    app: string;
  };
  user?: {
    /** As the person wrote it. Never rebuilt from an email address. */
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  /** The person who runs the studio. */
  owner?: boolean;
  builder?: {
    /** An OrangeCat account is connected, which is what opens an application. */
    connected: boolean;
    applications: { name: string | null; status: string }[];
  };
}

export interface StudioSessionInput {
  user: { name: string | null; username: string | null; image: string | null } | null;
  owner: boolean;
  /** null when no OrangeCat account is connected. */
  applications: { name: string | null; status: { title: string } }[] | null;
}

/**
 * The answer to "who is looking at the studio site?".
 *
 * It says who (a name, a handle, a picture) and what they can open. It never
 * carries an email address, an account id, an application id or an access
 * key: the page that asks is static and public, and anything in this answer
 * is readable by every script that page runs.
 */
export function studioSessionSummary(
  input: StudioSessionInput,
  appUrl: string,
  to?: string | null,
): StudioSessionSummary {
  const base = appUrl.replace(/\/+$/, "");
  const back = typeof to === "string" && to !== "/" ? `?to=${encodeURIComponent(to)}` : "";
  const links = {
    signIn: `${base}/studio/return${back}`,
    signOut: `${base}${ROUTES.SIGN_OUT}?then=studio`,
    builder: `${base}/studio/partner`,
    review: `${base}/feedback/studio`,
    app: `${base}${ROUTES.APP_HOME}`,
  };
  if (!input.user) return { signedIn: false, links };
  return {
    signedIn: true,
    links,
    user: {
      name: input.user.name?.trim() || null,
      handle: input.user.username?.trim() || null,
      image: /^https:\/\//.test(input.user.image ?? "") ? input.user.image : null,
    },
    owner: input.owner,
    builder: {
      connected: input.applications !== null,
      applications: (input.applications ?? []).map((a) => ({
        name: a.name?.trim() || null,
        status: a.status.title,
      })),
    },
  };
}
