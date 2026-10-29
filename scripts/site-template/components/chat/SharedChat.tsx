"use client";

import {
  ChatStarters,
  ChatThread,
  Composer,
  type ChatMessageData,
  type ComposerLabelOverrides,
  type Starter,
  type ThreadLabels,
} from "@bitbaum/chatkit/react";

/** Product supplies its own localized labels and answer function; chat behavior stays shared. */
export function SharedChat({
  messages,
  onSend,
  sending = false,
  starters,
  emptyTitle,
  placeholder,
  ariaLabel,
  composerLabels,
  threadLabels,
}: {
  messages: ChatMessageData[];
  onSend: (text: string) => boolean | Promise<boolean>;
  sending?: boolean;
  starters: readonly Starter[];
  emptyTitle: string;
  placeholder: string;
  ariaLabel: string;
  composerLabels?: ComposerLabelOverrides;
  threadLabels?: Partial<ThreadLabels>;
}) {
  return (
    <section aria-label={ariaLabel}>
      <ChatThread
        messages={messages}
        live={sending ? { status: threadLabels?.working ?? "Working on it…" } : null}
        labels={threadLabels}
        empty={
          <ChatStarters
            starters={starters}
            title={emptyTitle}
            onPick={(prompt) => void onSend(prompt)}
          />
        }
      />
      <Composer
        onSend={(text) => onSend(text)}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        sending={sending}
        attach={false}
        voice={false}
        labels={composerLabels}
      />
    </section>
  );
}
