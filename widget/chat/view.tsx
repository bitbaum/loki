/**
 * The widget's conversation drawn with the shared chat — chatkit's thread and
 * composer, the same ones Loki's own chat renders (docs/architecture/
 * feedback-widget.md). Built into the separate chunk public/widget-chat.js
 * (scripts/build-widget-chat.ts) with Preact standing in for React, and loaded
 * only when the panel opens, so a site's visitors who never open it pay
 * nothing for it.
 *
 * A dumb renderer: every word and action comes in `KitState` from the widget
 * (conversation.ts), which keeps the rules in conversation-model.ts.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatReplies, ChatThread, Composer } from "@bitbaum/chatkit/react";
import type { Attachment } from "@bitbaum/chatkit";
import chatkitCss from "@bitbaum/chatkit/styles.css";
import type { KitDeps, KitHandle, KitMessage, KitModule, KitState } from "./contract";

/** A widget-built DOM node, mounted where chatkit leaves a slot. */
function Dom({ node, className }: { node: HTMLElement | null | undefined; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current && node) ref.current.replaceChildren(node);
  }, [node]);
  return node ? <div ref={ref} className={className} /> : null;
}

const asDataUrls = (atts: Attachment[]) =>
  atts.flatMap((a) => (a.kind === "image" ? [`data:${a.mimeType};base64,${a.dataBase64}`] : []));

/** Links in answers leave the site in a new tab, and only http(s) is a link. */
const renderLink = (href: string, children: unknown) =>
  /^https?:\/\//i.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children as never}
    </a>
  ) : (
    <>{children as never}</>
  );

function WidgetChat({
  deps,
  initial,
  bind,
}: {
  deps: KitDeps;
  initial: KitState;
  bind: (set: (s: KitState) => void, focus: () => void) => void;
}) {
  const [state, setState] = useState(initial);
  const [mode, setMode] = useState(initial.modes[0]?.id ?? "ask");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => bind(setState, () => inputRef.current?.focus()), [bind]);

  const current = state.modes.find((m) => m.id === mode) ?? state.modes[0];
  const footers = new Map(state.messages.map((m: KitMessage) => [m.id, m.footer]));

  return (
    <div className="fc-kit">
      <ChatThread
        messages={state.messages.map(({ footer: _f, ...m }) => m)}
        live={state.live}
        onReply={
          !state.sending && state.modes.some((mode) => mode.id === "ask")
            ? (text) => deps.send("ask", text)
            : undefined
        }
        renderLink={renderLink as never}
        renderFooter={(m) => <Dom node={footers.get(m.id)} className="fc-kit-footer" />}
      >
        <Dom node={state.after} className="fc-kit-after" />
      </ChatThread>
      {!state.reviewingNote && (
        <Composer
          inputRef={inputRef}
          placeholder={state.placeholder}
          sending={state.sending}
          modes={state.modes.length > 1 ? state.modes : undefined}
          mode={current?.id}
          onModeChange={setMode}
          labels={{ send: current?.send ?? "Send" }}
          attach={{ maxFiles: 5, maxImageEdge: 1024 }}
          heldAttachments={state.held}
          voice={
            deps.transcribe
              ? { transcribe: deps.transcribe, rememberKey: null, maxRecordingMs: 110_000 }
              : false
          }
          above={
            state.starters.length ? (
              <ChatReplies
                replies={state.starters.map((s) => s.label)}
                onPick={(label) => state.starters.find((s) => s.label === label)?.pick()}
              />
            ) : undefined
          }
          header={<Dom node={state.header} />}
          tools={state.tools ? <Dom node={state.tools} /> : undefined}
          footer={<Dom node={state.footer} />}
          onSend={(text, atts) => {
            const images = asDataUrls(atts);
            if (images.length) deps.stage(images);
            deps.send(current?.id ?? "ask", text);
          }}
        />
      )}
    </div>
  );
}

const mount: KitModule["mount"] = (container, deps, state) => {
  const style = document.createElement("style");
  style.textContent = `${chatkitCss}\n${deps.vars}`;
  const slot = document.createElement("div");
  slot.className = "fc-kit-root";
  container.replaceChildren(style, slot);
  // Until the component has bound itself, an update is kept and replayed.
  let latest = state;
  let set: (s: KitState) => void = (s) => void (latest = s);
  let focus = () => {};
  const bind = (s: (next: KitState) => void, f: () => void) => {
    set = s;
    focus = f;
    s(latest);
  };
  const root = createRoot(slot);
  root.render(<WidgetChat deps={deps} initial={state} bind={bind} />);
  const handle: KitHandle = {
    update: (s) => set(s),
    focus: () => focus(),
    unmount: () => root.unmount(),
  };
  return handle;
};

export const kit: KitModule = { mount };
