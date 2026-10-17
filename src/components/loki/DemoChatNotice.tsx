"use client";

/**
 * What the chat does in the public demo.
 *
 * The demo account is shared by every visitor, so it may not call a model
 * (config/demo.ts, "spend"). That rule stays. What changed is how it feels:
 * the chat used to send the message anyway, the server refused it, the words
 * vanished and a red line blamed "a paid model" — while the model menu under
 * it promised free answers. The first thing a visitor tried was the one thing
 * that silently failed (owner's walk-through, 2026-10-17).
 *
 * Now nothing is sent. The visitor's words stay on screen, Loki says plainly
 * why it cannot answer here, and the next step is one tap: a free account, or
 * the real work already in the demo. No dead end (CLAUDE.md "No dead ends").
 */
import { useContext, useState } from "react";
import Link from "next/link";
import { SessionContext } from "next-auth/react";
import { ROUTES } from "@/config/auth";

export function useDemoChat() {
  // The context, not useSession(): the chat also renders without a session
  // provider (scripts/test/mobile-flow-browser.ts), where useSession throws.
  // No session there simply means not the demo.
  const session = useContext(SessionContext)?.data;
  const [asked, setAsked] = useState<string | null>(null);
  return {
    isDemo: session?.user?.isDemo === true,
    asked,
    show: (text: string) => setAsked(text.trim() || null),
  };
}

export function DemoChatNotice({ asked }: { asked: string }) {
  return (
    <div className="ui-loki-thread-inner" aria-live="polite">
      <div className="ui-loki-turn-user">
        <div className="ui-loki-bubble ui-loki-bubble-user">{asked}</div>
      </div>
      <div className="ui-loki-turn">
        <div className="ui-loki-answer space-y-2">
          <p>
            I can&apos;t answer in the demo — it&apos;s one account shared by everyone who opens it,
            so the chat is switched off here.
          </p>
          <p>
            With your own account — free — I&apos;d answer this, and if you want it built, hand it
            to an agent and show you each step until it&apos;s live.
          </p>
        </div>
        <div className="ui-loki-dispatch-actions">
          <Link href={ROUTES.SIGN_UP} className="ui-btn-primary">
            Create your free account
          </Link>
          <Link href="/activity" className="ui-loki-dispatch-secondary">
            See what agents built here
          </Link>
        </div>
      </div>
    </div>
  );
}
