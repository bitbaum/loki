import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "Privacy",
  description: "What Loki collects, why, who else sees it, and what you can do about it.",
};

const thirdParties: { name: string; why: string; href?: string }[] = [
  {
    name: "Hetzner",
    why: "Runs the server that hosts Loki, its database and the cloud builder. Sees request metadata as any host would, and stores what the server stores.",
    href: "https://www.hetzner.com/legal/privacy-policy",
  },
  {
    name: "OrangeCat",
    why: "The main way to sign in. If you use it, OrangeCat tells Loki who you are (your account id, name, email and picture). If you link your account, Loki can also hand a project to OrangeCat — only when you choose to.",
    href: "https://www.orangecat.ch",
  },
  {
    name: "GitHub",
    why: "Sign-in, if you choose it. Also where repositories Loki creates for you are stored (in the bitbaum organisation), and where agents push their changes.",
    href: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
  },
  {
    name: "Google",
    why: "Sign-in, if you choose it. Google also provides one of the AI models behind Loki's chat (see below).",
    href: "https://policies.google.com/privacy",
  },
  {
    name: "X",
    why: "Sign-in, if you choose it.",
    href: "https://x.com/en/privacy",
  },
  {
    name: "Resend",
    why: "Sends Loki's emails (email confirmations, password resets, invitations, notes that a reported problem was fixed). Sees the address and the message.",
    href: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Groq, Google and OpenRouter",
    why: "Run the AI models behind Loki's own chat assistant, the feedback widget's Ask Loki tab, spoken feedback (Groq turns speech into text), and the walkthrough after a fix. They receive what you or a visitor typed or said, and an outline of the page being asked about. If you add your own key, your key is used instead.",
  },
  {
    name: "Your agents' providers",
    why: "The agents that write code — Claude Code (Anthropic), Codex (OpenAI), Cursor, Antigravity (Google) and Grok (xAI) — send your prompts and the code they work on to their own companies. On your computer they use your own sign-ins; on the cloud builder they use Loki's.",
  },
  {
    name: "Telegram",
    why: "Only if you connect it: Loki sends you approvals and updates there, and reads your replies.",
    href: "https://telegram.org/privacy",
  },
];

export default function PrivacyPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="mx-auto max-w-3xl px-6 py-16 ui-public-prose">
        <h1 className="ui-public-title mb-2">Privacy</h1>
        <p className="ui-public-meta mb-12">Last updated 2026-10-01</p>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Plain English</h2>
          <p>
            Loki is a personal project run by Cato. It is not yet a registered company. The product
            collects what it needs to sign you in, run agents on your behalf, and show you your work
            on any device.
          </p>
          <p>
            We don&apos;t sell your data, we don&apos;t share it with advertisers, and we don&apos;t
            have any. If you delete your account, your records are deleted with it.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">What we collect</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Account identity</strong> — what the sign-in you chose sends us: from
              OrangeCat, GitHub, Google or X, your account id, name, email and picture; or the email
              address and password (stored hashed) you set for Loki.
            </li>
            <li>
              <strong>Agent tokens</strong> — tokens you create in Settings → Agent tokens to sign
              in Fleet Runner and other tools. Stored hashed, not in plaintext.
            </li>
            <li>
              <strong>What you create</strong> — projects, prompts, goals, events, habits,
              subscriptions, people, memory entries, crew assignments, conversations with Loki, and
              images you upload. These are your data. We process them to show your dashboards and to
              send work to agents.
            </li>
            <li>
              <strong>Agent run records</strong> — when work was sent, what came back, errors. Used
              to show run history and to recover from crashes.
            </li>
            <li>
              <strong>Newsletter</strong> — your email address, only if you subscribe.
            </li>
            <li>
              <strong>Operational logs</strong> — minimal request logs (path, status code, timing).
              No request bodies, no personal data beyond the user id a request was signed in as.
              Retained 30 days for debugging.
            </li>
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Where your code goes</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>On your computer (Fleet Runner)</strong> — your code stays on your computer,
              except what your agent sends to its own provider while it works. Fleet Runner tells
              Loki only what it needs to show you progress: the projects you register, session state
              and run outcomes.
            </li>
            <li>
              <strong>On Loki&apos;s cloud builder</strong> — the project&apos;s repository is
              copied (cloned) to Loki&apos;s server at Hetzner, and the agents work on it there.
            </li>
            <li>
              <strong>Repositories Loki creates</strong> — are stored on GitHub in the bitbaum
              organisation.
            </li>
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">If you used a Loki feedback button</h2>
          <p>
            Many websites built with Loki carry a small feedback button. If you used one, this
            section is about you.
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              We store what you wrote or said, any picture you attached, the page you were on, the
              part of the page you pointed at, your browser&apos;s user-agent string, and a name or
              email only if you left one.
            </li>
            <li>
              Your IP address is used briefly to stop abuse (rate limits). It is not stored with
              your report.
            </li>
            <li>
              The site&apos;s owner sees your report in Loki and may hand it to an AI agent to fix.
              If you used Ask Loki or spoke your feedback, your words and an outline of the page
              went to the AI providers listed below.
            </li>
            <li>
              If you left an email, you get a short note when your report is fixed, and nothing
              else. If you sign in to Loki, you can see your reports on My feedback.
            </li>
            <li>
              To have a report deleted, email{" "}
              <a href="mailto:cato@orangecat.ch" className="ui-public-link">
                cato@orangecat.ch
              </a>{" "}
              with the site and roughly when you sent it.
            </li>
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">What we don&apos;t collect</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              No marketing / analytics tracking (no Google Analytics, no Meta Pixel, no LinkedIn
              tag).
            </li>
            <li>No session replay, no heatmaps, no behavioral analytics.</li>
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Who else sees data</h2>
          <ul className="list-disc pl-6 space-y-2">
            {thirdParties.map((t) => (
              <li key={t.name}>
                <strong>{t.name}</strong> — {t.why}
                {t.href && (
                  <>
                    {" "}
                    <a
                      href={t.href}
                      className="ui-public-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Privacy policy
                    </a>
                    .
                  </>
                )}
              </li>
            ))}
          </ul>
          <p>
            Loki&apos;s database is PostgreSQL on our own server; no outside database company holds
            your records. We are not using any analytics, advertising, A/B testing, or marketing
            platforms. If we add any, this page will be updated and existing users notified by
            email.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Your rights</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Access</strong> — your dashboard already shows everything we hold about you.
            </li>
            <li>
              <strong>Export</strong> — Settings → Privacy → Export downloads your records.
            </li>
            <li>
              <strong>Delete</strong> — Settings → Delete account purges your records.
            </li>
            <li>
              <strong>Correct</strong> — edit any field inline in the dashboard.
            </li>
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Contact</h2>
          <p>
            For privacy questions, email{" "}
            <a href="mailto:cato@orangecat.ch" className="ui-public-link">
              cato@orangecat.ch
            </a>{" "}
            or open an issue at{" "}
            <a
              href="https://github.com/bitbaum/loki/issues"
              className="ui-public-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/bitbaum/loki/issues
            </a>
            .
          </p>
        </section>

        <p className="ui-public-meta mt-16">
          This is a pre-incorporation product. If Loki becomes part of a registered entity, this
          policy will be updated to reflect it. Existing rights will not be reduced by that
          transition.
        </p>
      </main>
    </PublicSurface>
  );
}
