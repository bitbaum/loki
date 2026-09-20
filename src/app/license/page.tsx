import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "License",
  description: "Loki is MIT licensed. How the source, the binaries and the name may be used.",
};

export default function LicensePage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="mx-auto max-w-3xl px-6 py-16 ui-public-prose">
        <h1 className="ui-public-title mb-2">License</h1>
        <p className="ui-public-meta mb-12">MIT. The name is the only carve-out.</p>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Plain English</h2>
          <p>
            Loki is released under the{" "}
            <a
              href="https://github.com/bitbaum/loki/blob/main/LICENSE"
              className="ui-public-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              MIT License
            </a>
            , © 2025-2026 Cato. Read it, run it, fork it, change it, ship it, sell it. You do not
            need permission and you do not need to ask.
          </p>
          <p>
            That includes running your own instance for anyone you like, including commercially, and
            including as a hosted service that competes with this one. MIT means what it says.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">What MIT requires of you</h2>
          <p>
            One thing: keep the copyright notice and the permission notice in copies or substantial
            portions of the software. That is the whole obligation.
          </p>
          <p>
            And one thing it withholds: the software is provided &ldquo;as is&rdquo;, without
            warranty of any kind.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">The name is not part of the grant</h2>
          <p>
            MIT covers the code. It does not grant rights to the &ldquo;Loki&rdquo; name, the
            wordmark, or the visual identity. Fork the software freely — just ship it under your own
            name, so nobody is misled about who stands behind a build.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Third-party software</h2>
          <p>
            Loki bundles open-source dependencies including but not limited to Electron, React,
            Next.js, Tailwind, and Drizzle. Each is governed by its own license, included in the
            source tree under <code>node_modules/</code> for the JavaScript ecosystem and in the
            released Fleet Runner binary&apos;s LICENSES files for the native components. The MIT
            grant on this project does not override those upstream licenses.
          </p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="ui-public-prose-h2">Questions</h2>
          <p>
            Open an issue at{" "}
            <a
              href="https://github.com/bitbaum/loki/issues"
              className="ui-public-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/bitbaum/loki/issues
            </a>
            . You do not need to ask for usage rights — MIT already granted them.
          </p>
        </section>
      </main>
    </PublicSurface>
  );
}
