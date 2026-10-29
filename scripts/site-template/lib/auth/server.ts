import { createAuthRuntime } from "@bitbaum/accountkit/auth/next";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { mailConfigured, sendAuthMail } from "@/lib/mail";
import { SITE } from "@/lib/site";
export const { GET, POST, getSession, requireUser, getAuth, authStatus } = createAuthRuntime({
  site: { url: SITE.url, title: SITE.title, slug: SITE.slug },
  getDatabase: getDb,
  isDatabaseConfigured,
  mail: {
    get configured() {
      return mailConfigured();
    },
    send: sendAuthMail,
  },
});
export type Auth = ReturnType<typeof getAuth>;
