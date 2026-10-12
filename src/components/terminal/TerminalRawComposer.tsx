"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePressVerb } from "@/hooks/use-press-verb";

/**
 * Type into the session without fighting the terminal for focus.
 *
 * The old phone flow was "tap the black rectangle, hope the keyboard opens,
 * type into a canvas". Every part of that is fragile on a phone: xterm's hidden
 * textarea is a 1×1 element the browser is reluctant to focus, autocorrect
 * rewrites shell words mid-command, and the IME's composition buffer sends
 * partial UTF-8 to a PTY that expects finished bytes. The status line even said
 * "LIVE · TAP TO TYPE", which was a request, not a feature.
 *
 * A real `<textarea>` fixes all of it at once: the browser focuses it, the
 * operator can see and edit what they are about to send, autocorrect can be
 * turned off properly, and the whole line lands in the PTY as one write.
 *
 * Send appends a carriage return by default — the overwhelmingly common intent
 * is "run this". The ⏎ toggle turns that off for the case that genuinely needs
 * it: typing into a TUI's own filter or search field, where submitting early
 * picks the wrong item. It is a visible two-state chip rather than a hidden
 * gesture, because a thing that changes what your keystrokes mean has to be
 * readable at a glance.
 */
export function TerminalRawComposer({
  onSend,
  sessionLabel,
  focusRequest = 0,
}: {
  /** A new value takes the cursor (the screen above was tapped to type). */
  focusRequest?: number;
  /** Writes verbatim bytes into the session (transport.sendKey). */
  onSend: (bytes: string) => void;
  sessionLabel: string;
}) {
  const [text, setText] = useState("");
  const [withEnter, setWithEnter] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const press = usePressVerb();
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const send = () => {
    if (!text) return;
    onSend(withEnter ? `${text}\r` : text);
    setText("");
    // Stay focused: the keyboard must not close between two lines of a
    // conversation with an agent.
    inputRef.current?.focus();
  };

  return (
    <div className="ui-term-mcomposer">
      <textarea
        ref={inputRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        // A terminal is not prose. Left on, autocorrect turns `cd ~/src` into
        // `cd ~/sec` and capitalises flags — silently, after the send.
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder={`Type into ${sessionLabel}…`}
        aria-label={`Type into ${sessionLabel}`}
        className="ui-term-mcomposer-input"
        style={{ fieldSizing: "content", maxHeight: "6rem" } as React.CSSProperties}
      />

      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setWithEnter((v) => !v)}
        aria-pressed={withEnter}
        title={
          withEnter
            ? `Send runs the line (Enter is added). ${press.Verb} to type the text without submitting.`
            : `Send types the text only. ${press.Verb} to add Enter and run it.`
        }
        className={cn("ui-term-mcomposer-enter", withEnter && "ui-term-mcomposer-enter-on")}
      >
        <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={send}
        disabled={!text}
        aria-label={withEnter ? "Send and run" : "Send without Enter"}
        className="ui-term-mcomposer-send"
      >
        Send
      </button>
    </div>
  );
}
