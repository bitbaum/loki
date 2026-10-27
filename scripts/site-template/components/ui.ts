/**
 * The few recurring shapes, as class strings over @bitbaum/design-tokens'
 * semantic names. Every control is at least 44px tall (fleet navigation
 * contract rule 3) and text inputs are 16px so iOS does not zoom on focus.
 */
export const shell = "mx-auto w-full max-w-3xl px-4 sm:px-6";

export const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-fg-primary px-5 text-base font-medium text-surface-page transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

export const buttonQuiet =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-default px-5 text-base text-fg-primary transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

export const input =
  "block min-h-11 w-full rounded-lg border border-default bg-surface-base px-3 text-base text-fg-primary placeholder:text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export const label = "block text-sm font-medium text-fg-primary";

export const card = "rounded-xl border border-subtle bg-surface-raised p-5 sm:p-6";

export const link =
  "inline-flex min-h-11 items-center text-fg-secondary underline decoration-border-subtle underline-offset-4 hover:text-fg-primary";

export const notice =
  "rounded-lg border border-subtle bg-surface-base px-4 py-3 text-sm text-fg-secondary";

export const errorText = "text-sm text-status-negative";
