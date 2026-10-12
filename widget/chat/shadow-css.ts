/**
 * chatkit's stylesheet, made to work inside the widget's Shadow DOM.
 *
 * Two things in it assume it owns the page, and neither holds on someone
 * else's site:
 *  - its defaults sit on `:where(:root)`, which never matches inside a shadow
 *    root — every --ck-* would be undefined. They move to `:where(:host)`
 *    (the widget then sets them from its boot theme, chat/theme.ts);
 *  - it sizes everything in `rem`, which is the HOST page's root font size.
 *    A site with `html { font-size: 62.5% }` would shrink the 16px input to
 *    10px (iOS zooms the page on focus) and the 44px targets to 27px. The
 *    widget is drawn at fixed sizes everywhere else; so is this.
 *
 * Applied at build time (scripts/build-widget-chat.ts), so the chunk ships the
 * corrected CSS as a string.
 */
export function shadowChatkitCss(css: string, rootPx = 16): string {
  return css
    .replace(/:where\(:root\)/g, ":where(:host)")
    .replace(/(-?\d*\.?\d+)rem\b/g, (_, n: string) => `${+(Number(n) * rootPx).toFixed(3)}px`);
}
