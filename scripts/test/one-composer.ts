// ONE composer for one job. Loki chat, the terminal's Ask/Inject rail, the
// Prompt-mode box and Control's quick send were four components with four
// looks; the rail's "Inject into <project>" box had no attachments and no
// voice. These cases pin (1) the decisions every call site shares, (2) what the
// shared component renders for each call site's props, and (3) that no call
// site grows its own textarea again.
// Run: npx tsx scripts/test/one-composer.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import {
  composerCanSend,
  composerOutgoingText,
  shouldClearDraft,
} from "@/components/composer/composer-logic";
import { Composer } from "@/components/composer/Composer";
import { terminalComposerModes } from "@/components/terminal/terminal-composer-modes";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}
const has = (html: string, needle: string) => html.includes(needle);

// --- (1) shared decisions -----------------------------------------------------
{
  const base = { attachmentCount: 0, sending: false, disabled: false, blocked: false };
  eq(composerCanSend({ ...base, text: "ship it" }), true, "words can be sent");
  eq(composerCanSend({ ...base, text: "   " }), false, "whitespace is not a message");
  eq(
    composerCanSend({ ...base, text: "", attachmentCount: 1 }),
    false,
    "an attachment alone cannot send where the call site gave it no meaning",
  );
  eq(
    composerCanSend({ ...base, text: "", attachmentCount: 1, attachmentOnlyText: "Fix this." }),
    true,
    "…and can where it did (a screenshot is a complete instruction)",
  );
  eq(composerCanSend({ ...base, text: "x", sending: true }), false, "no double send in flight");
  eq(composerCanSend({ ...base, text: "x", disabled: true }), false, "disabled means disabled");
  eq(
    composerCanSend({ ...base, text: "x", blocked: true }),
    false,
    "a blocked send (inject with no session) cannot fire",
  );
  eq(composerOutgoingText("  hi  ", 0), "hi", "the draft is trimmed");
  eq(composerOutgoingText("", 2, "Fix this."), "Fix this.", "attachments-only uses the stand-in");
  eq(composerOutgoingText("", 0, "Fix this."), "", "no stand-in without an attachment");
  eq(shouldClearDraft(undefined), true, "a send that returns nothing clears the draft");
  eq(shouldClearDraft(true), true, "a successful send clears the draft");
  eq(shouldClearDraft(false), false, "a failed send KEEPS the draft for retry");
}

// --- terminal modes ------------------------------------------------------------
{
  const both = terminalComposerModes(["ask", "inject"], { project: "loki", tab: "loki" });
  eq(
    both.map((m) => m.id),
    ["ask", "inject"],
    "the rail offers Ask and Inject, in that order",
  );
  eq(
    terminalComposerModes(["ask", "inject"], { project: null, tab: "t" }).map((m) => m.id),
    ["inject"],
    "Ask is dropped when there is no project to ask about",
  );
  eq(
    terminalComposerModes(["inject"], { project: null, tab: null }).map((m) => m.id),
    ["inject"],
    "Inject stays offered with no session — it says why it cannot send",
  );
}

// --- (2) what the one component renders per call site -------------------------
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(Composer, { onSend: () => undefined, placeholder: "Write…", ...props }),
  );
{
  // Loki chat: attach + model picker (voice renders only where the browser can
  // record, which a server render cannot — its absence here is the SSR default).
  const chat = render({ modelPicker: true });
  eq(has(chat, "ck-input"), true, "chat renders the shared input");
  eq(has(chat, 'aria-label="Attach a screenshot or file"'), true, "chat can attach");
  eq(has(chat, "ui-loki-model"), true, "chat offers the model picker");
  eq(has(chat, "ck-modes"), false, "chat has no mode toggle");

  // The terminal rail: same component, Ask/Inject toggle, attach on.
  const rail = render({
    modes: [
      { id: "ask", label: "Ask" },
      { id: "inject", label: "Inject" },
    ],
    mode: "inject",
    density: "compact",
  });
  eq(has(rail, "ck-input"), true, "the rail renders the SAME input as chat");
  eq(has(rail, 'aria-label="Attach a screenshot or file"'), true, "the rail can attach now");
  eq(has(rail, "ck-modes"), true, "the rail shows Ask / Inject");
  eq(has(rail, 'aria-pressed="true">Inject'), true, "the active mode is pressed");
  eq(has(rail, "ck-composer-compact"), true, "compact density is a class, not a fork");
  eq(has(rail, "ui-loki-model"), false, "Inject offers no model picker (the CLI is the session's)");

  // A single mode renders no toggle at all.
  eq(
    has(
      render({ modes: [{ id: "inject", label: "Inject" }], mode: "inject" }),
      "ck-modes",
    ),
    false,
    "one destination renders no toggle",
  );

  // Blocked: the reason is on the send button, and it is disabled.
  const blocked = render({ value: "do it", sendBlockedReason: "Open a session first." });
  eq(has(blocked, 'title="Open a session first."'), true, "a blocked send says why");
  eq(/<button[^>]*disabled=""[^>]*aria-label="Send/.test(blocked), true, "…and is disabled");
  const ready = render({ value: "do it" });
  eq(/<button[^>]*disabled=""[^>]*aria-label="Send/.test(ready), false, "a ready send is enabled");

  // attach={false} really removes it.
  eq(
    has(render({ attach: false }), "Attach a screenshot or file"),
    false,
    "attach can be turned off",
  );
  // Stop takes the send slot only when the caller can stop.
  eq(
    has(render({ sending: true, onStop: () => {} }), "Stop generating"),
    true,
    "Stop while sending",
  );
  eq(has(render({ sending: true }), "Stop generating"), false, "no Stop without onStop");
}

// --- (3) no call site grows its own composer again ----------------------------
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  for (const file of [
    "src/components/loki/Composer.tsx",
    "src/components/terminal/TerminalComposer.tsx",
    "src/components/terminal/TerminalLokiRail.tsx",
    "src/components/control/LiveTerminalPanel.tsx",
  ]) {
    const src = read(file);
    eq(
      /<textarea|<input\s[^>]*value=\{prompt/.test(src),
      false,
      `${file} has no textarea of its own`,
    );
  }
  eq(
    /from "@\/components\/composer\/Composer"/.test(read("src/components/loki/Composer.tsx")),
    true,
    "Loki chat renders the shared composer",
  );
  eq(
    /from "@\/components\/composer\/Composer"/.test(
      read("src/components/terminal/TerminalComposer.tsx"),
    ),
    true,
    "the terminal composer renders the shared composer",
  );
  eq(
    /<TerminalComposer/.test(read("src/components/terminal/TerminalLokiRail.tsx")),
    true,
    "the rail's Ask/Inject box is the terminal composer",
  );
}

console.log(`one-composer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
