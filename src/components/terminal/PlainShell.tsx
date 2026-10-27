"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Lock, SquareTerminal } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { SectionHeading } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { PIN_MAX_DIGITS } from "@/lib/constants/auth";
import { shellPlaceLabel } from "@/lib/shell-session";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { KeysToggle } from "./TerminalMobileDock";
import { TerminalKeyDeck } from "./TerminalKeyDeck";
import type { PlainShellControl } from "./use-plain-shell";

/** The PIN asked for: one field, one button that says what it unlocks. */
export function ShellPinForm({
  idleMinutes,
  onUnlock,
}: {
  idleMinutes: number;
  onUnlock: (pin: string) => Promise<string | null>;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setBusy(true);
    setError(null);
    const problem = await onUnlock(pin);
    setBusy(false);
    if (problem) {
      setError(problem);
      setPin("");
      input.current?.focus();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        ref={input}
        autoFocus
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder="PIN"
        aria-label="PIN for the shell"
        value={pin}
        maxLength={PIN_MAX_DIGITS}
        onChange={(e) => setPin(e.target.value)}
        disabled={busy}
        className="ui-input ui-pin-input w-full text-center text-2xl"
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !pin} className="ui-btn-primary min-h-11 w-full">
        <Lock className="h-4 w-4" aria-hidden="true" />
        {busy ? "Unlocking…" : "Unlock the shell"}
      </button>
      <p className="text-sm text-text-tertiary">
        Locks again after {idleMinutes} minutes without typing.
      </p>
    </form>
  );
}

/** The sheet the PIN is asked in, on the way to opening a shell. */
export function ShellPinSheet({ shell }: { shell: PlainShellControl }) {
  if (!shell.pinOpen) return null;
  return (
    <Modal
      onClose={shell.closePin}
      position="bottom-mobile"
      padded={false}
      size="md"
      className="ui-sheet"
      labelledBy="shell-pin-title"
    >
      <div className="ui-sheet-grip" aria-hidden="true" />
      <div className="ui-sheet-body">
        <h2 id="shell-pin-title" className="ui-section-heading">
          Unlock the shell
        </h2>
        <p className="text-sm text-text-secondary">
          A real command line on {shellPlaceLabel(shell.channel)}. Enter your PIN to open it.
        </p>
        <ShellPinForm idleMinutes={shell.status?.idleMinutes ?? 10} onUnlock={shell.unlock} />
      </div>
      <div className="ui-sheet-foot">
        <button type="button" className="ui-btn-secondary w-full" onClick={shell.closePin}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Shown in place of a shell's screen once it has locked. Nothing of the
 *  session is drawn until the PIN is entered again. */
export function ShellLockedPanel({ shell }: { shell: PlainShellControl }) {
  return (
    <div className="ui-term-shell-locked" role="status">
      <h2 className="ui-section-heading">Shell locked</h2>
      <p className="text-sm text-text-secondary">
        It locked after {shell.status?.idleMinutes ?? 10} minutes without typing. The shell is still
        running — enter your PIN to carry on.
      </p>
      <ShellPinForm idleMinutes={shell.status?.idleMinutes ?? 10} onUnlock={shell.unlock} />
    </div>
  );
}

/** "A real shell on <place>" — drawn above every shell, so it is never taken
 *  for a project session. */
export function ShellBanner({ channel, onLock }: { channel: BuilderChannel; onLock: () => void }) {
  return (
    <div className="ui-term-shellbar" role="note">
      <SquareTerminal className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong>Real shell</strong> on {shellPlaceLabel(channel)} · no project, no agent
      </span>
      <button type="button" className="ui-btn-ghost min-h-11 shrink-0" onClick={onLock}>
        Lock
      </button>
    </div>
  );
}

/**
 * The way in: one row, the same anatomy as the project rows beside it. Hidden
 * for anyone but the operator (the server says who that is).
 */
export function ShellEntryRows({ shell, heading }: { shell: PlainShellControl; heading?: string }) {
  const { status } = shell;
  if (!status?.allowed) return null;
  const place = shellPlaceLabel(shell.channel);
  const needsPin = !status.pinConfigured;
  const offline = !status.online;
  const full = status.open >= status.max;
  return (
    <>
      {heading && <SectionHeading title={heading} className="mt-4" />}
      <List aria-label="Plain shell">
        {needsPin ? (
          <ListRow
            icon={SquareTerminal}
            title="Plain shell"
            secondary="Set a PIN first — the shell is locked behind it"
            href="/settings#privacy"
            label="Set a PIN in Settings so you can open a shell"
            trailing={<span className="ui-term-resume-go">Set PIN</span>}
          />
        ) : (
          <ListRow
            icon={SquareTerminal}
            title="Plain shell"
            secondary={
              shell.busy
                ? "Opening…"
                : offline
                  ? `${place[0]!.toUpperCase()}${place.slice(1)} is not connected`
                  : full
                    ? `${status.max} shells are already open here`
                    : `A command line on ${place}, no project`
            }
            onClick={offline || full || shell.busy ? undefined : shell.start}
            label={`Open a plain shell on ${place}`}
            trailing={<span className="ui-term-resume-go">Open</span>}
          />
        )}
      </List>
      {shell.error && (
        <p className="ui-error" role="alert">
          {shell.error}{" "}
          {needsPin && (
            <Link href="/settings#privacy" className="underline">
              Open Settings
            </Link>
          )}
        </p>
      )}
    </>
  );
}

/** A shell has no agent box: keys go straight to the screen, and only the keys
 *  a soft keyboard lacks (arrows, Esc, Tab, Ctrl) are one press away. */
export function ShellKeys({
  onKey,
  open,
  onOpenChange,
}: {
  onKey: (bytes: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="ui-term-dock">
      <span className="md:hidden">
        <KeysToggle open={open} onOpenChange={onOpenChange} floating />
      </span>
      {open && <TerminalKeyDeck onKey={onKey} onClose={() => onOpenChange(false)} />}
    </div>
  );
}
