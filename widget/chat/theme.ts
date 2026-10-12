/**
 * The shared chat in the widget's colours: chatkit reads --ck-* variables
 * (its styles.css), the widget has a boot theme generated from the design
 * tokens (theme.ts). This maps one onto the other, once, so the chat matches
 * the panel around it on every site and in both themes — and chatkit's own
 * defaults (which read the host page's token variables) never leak in.
 */
import type { WidgetTheme } from "../theme";

export function chatkitVars(t: WidgetTheme): string {
  const vars: Record<string, string> = {
    "--ck-bg": t.surface,
    "--ck-raised": t.surfaceRaised,
    "--ck-overlay": t.surfaceSubtle,
    "--ck-fg": t.text,
    "--ck-fg-2": t.textSecondary,
    "--ck-fg-3": t.textTertiary,
    "--ck-muted": t.textMuted,
    "--ck-line": t.border,
    "--ck-line-2": t.borderStrong,
    "--ck-accent": t.accent,
    "--ck-on-accent": t.inkOnAccent ?? t.black,
    "--ck-accent-soft": t.accentMuted,
    "--ck-danger": t.error,
    "--ck-danger-soft": t.errorSurface,
    "--ck-on-danger": t.white,
    // The boot theme has no warning colour; the accent is the widget's one
    // attention colour, and a host page's own token must not leak in instead.
    "--ck-warning": t.accent,
    "--ck-radius": t.radiusSurface ?? "8px",
    "--ck-radius-sm": t.radiusControl ?? "6px",
    "--ck-font": t.fontSans ?? "system-ui, -apple-system, sans-serif",
    "--ck-mono": t.fontMono ?? "ui-monospace, SFMono-Regular, Menlo, monospace",
  };
  return `:host { ${Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ")} }`;
}
