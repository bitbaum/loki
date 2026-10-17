import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "Terms",
  description: "What Loki promises, what it doesn't, and what's expected from you.",
};

export default function TermsPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="mx-auto max-w-3xl px-6 py-16 ui-public-prose">
        <h1 className="ui-public-title mb-2">Terms of use</h1>
        <p className="ui-public-meta mb-12">Last updated 2026-10-01</p>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Honest framing</h2>
          <p>
            Loki is a pre-incorporation product run by Cato. It is provided as-is, free of charge,
            under active development. These terms exist so the relationship is clear; they will be
            replaced with a proper agreement when the product is offered as a paid service by an
            incorporated entity.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Your account</h2>
          <p>
            You sign in with an OrangeCat account, or with GitHub, Google or X, or with an email
            address and a password just for Loki. By signing in you confirm the account you use is
            yours. Don&apos;t share your sign-in or your agent tokens — anyone with a valid token
            can start agents on the machine the token is installed on.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Acceptable use</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Use Loki to coordinate AI agents on your own projects, your employer&apos;s projects
              (if authorized), and other work you have the right to operate on.
            </li>
            <li>
              Don&apos;t use Loki to launch agents against systems you don&apos;t have permission to
              modify — it is a tool for directing your own work, not an attack platform.
            </li>
            <li>
              Don&apos;t use Loki in a way that breaks the terms of the AI providers your agents
              call (for example Anthropic, OpenAI, Cursor, Google or xAI). Their terms apply to your
              use of their models through Loki.
            </li>
            <li>
              Don&apos;t attempt to compromise other users&apos; data or infrastructure. The project
              is open about its boundaries; report vulnerabilities (see Security below) rather than
              exploit them.
            </li>
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">What you keep</h2>
          <p>
            You own your data — projects, prompts, agent outputs, dashboards, everything you create.
            We hold it on your behalf so the product can function. You can export or delete it at
            any time (see{" "}
            <a href="/privacy" className="ui-public-link">
              Privacy
            </a>
            ).
          </p>
          <p>
            <strong>Where your code lives.</strong> When Loki creates a repository for a project, it
            creates it in the{" "}
            <a
              href="https://github.com/bitbaum"
              className="ui-public-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              bitbaum organisation on GitHub
            </a>
            , not in your personal account. The code in it is yours. A project that runs on
            Loki&apos;s cloud builder has its code copied (cloned) to Loki&apos;s server so the
            agents can work on it there. A project that runs on your own computer through Fleet
            Runner stays there.
          </p>
          <p>
            The Loki source code is published under the license shown at{" "}
            <a href="/license" className="ui-public-link">
              /license
            </a>
            .
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">No warranty</h2>
          <p>
            The service is provided &ldquo;as is&rdquo; without warranty of any kind, express or
            implied. The maintainer is not liable for damages arising from use of the service —
            including but not limited to lost data, lost time, incorrect agent output, or
            interactions with third-party AI providers. Use it because it&apos;s useful, not because
            someone promised you a service level.
          </p>
          <p>
            Agents call external AI providers. On your own computer they use your own sign-ins and
            API keys, and Loki is not responsible for charges against them — set your own limits
            with each provider. On Loki&apos;s cloud builder they use Loki&apos;s credentials.
            Loki&apos;s own chat uses Loki&apos;s free AI allowance unless you add your own key.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Security disclosure</h2>
          <p>
            If you find a security issue, please <strong>do not file a public GitHub issue.</strong>{" "}
            Email{" "}
            <a href="mailto:cato@orangecat.ch" className="ui-public-link">
              cato@orangecat.ch
            </a>{" "}
            with &ldquo;Loki security&rdquo; in the subject. We&apos;ll acknowledge within 72 hours.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Changes</h2>
          <p>
            These terms may be updated; the &ldquo;last updated&rdquo; date at the top reflects the
            current version. Material changes will be announced in the{" "}
            <a href="/changelog" className="ui-public-link">
              changelog
            </a>{" "}
            and, where we have your email, by email.
          </p>
        </section>
      </main>
    </PublicSurface>
  );
}
