/**
 * The composer's decisions, kept out of the component so they can be tested
 * without a DOM — and so every call site of the one composer gets exactly the
 * same answer to "may this send?" and "does the draft survive?".
 */

/** A destination the same words can go to (the rail's Ask vs Inject). */
export type ComposerMode = { id: string; label: string; hint?: string };

/** `false` keeps the draft (the send failed or was refused); anything else
 *  clears it. */
export type ComposerSendResult = void | boolean;

export function composerCanSend({
  text,
  attachmentCount,
  attachmentOnlyText,
  sending,
  disabled,
  blocked,
}: {
  text: string;
  attachmentCount: number;
  attachmentOnlyText?: string;
  sending: boolean;
  disabled: boolean;
  blocked: boolean;
}): boolean {
  if (sending || disabled || blocked) return false;
  if (text.trim().length > 0) return true;
  // A screenshot with no words is still a complete message — but only where
  // the call site has said what that message means.
  return attachmentCount > 0 && Boolean(attachmentOnlyText);
}

/** The words actually sent: the draft, or the call site's stand-in for an
 *  attachments-only send. */
export function composerOutgoingText(
  text: string,
  attachmentCount: number,
  attachmentOnlyText?: string,
): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  return attachmentCount > 0 && attachmentOnlyText ? attachmentOnlyText : "";
}

export function shouldClearDraft(result: ComposerSendResult): boolean {
  return result !== false;
}
