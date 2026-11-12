"use client";

import { useRouter } from "next/navigation";
import { Composer } from "@/components/composer/Composer";
import { ROUTES } from "@/config/auth";
import { firstWordsHref, saveFirstWords } from "@/lib/first-words";

/**
 * The homepage's one action: say what you want, here, before anything else.
 *
 * The headline has read "Say what you want." since 2026-11-01 and the only
 * thing under it was a button to a four-field "Create an account" form that
 * never mentioned a project. This is the shared composer (the same box and
 * microphone as every Loki chat; never a second message box) and what is said
 * in it is kept: a signed-out visitor goes to sign-up with the sentence held
 * for them (lib/first-words), and it is waiting in the new-project form when
 * they arrive. Signed in, it goes straight there.
 */
export function HeroComposer({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  return (
    <div className="ui-public-hero-composer">
      <Composer
        onSend={(text) => {
          const words = text.trim();
          if (!words) return false;
          if (signedIn) {
            router.push(firstWordsHref(words));
          } else {
            saveFirstWords(words);
            router.push(ROUTES.SIGN_UP);
          }
          // Keep the words in the box while the next page loads.
          return false;
        }}
        // One line on a 390px screen (the box holds about 38 characters).
        placeholder="A website for my bakery, with a map…"
        ariaLabel="Say what you want built"
        attach={false}
        voice={signedIn ? true : "visitor"}
      />
    </div>
  );
}
