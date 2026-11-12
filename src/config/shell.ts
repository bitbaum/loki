import { ROUTES } from "./auth";

export const APP_HOME_HREF = ROUTES.APP_HOME;
export const SIDEBAR_COLLAPSE_STORAGE_KEY = "shell:sidebar-collapsed";
/**
 * The same choice in a cookie, so the SERVER draws the sidebar at the width the
 * person left it. localStorage alone meant the server always drew it open
 * (288px) and the browser folded it to 80px after hydration: every desktop
 * load slid the whole page 104px (layout shift 0.19 on most pages, 0.51 on
 * the chat). "true" or "false"; anything else, or no cookie, is the default.
 */
export const SIDEBAR_COLLAPSE_COOKIE = "loki-sidebar-collapsed";
/** Folded unless the person opened it: the default the shell has always had. */
export const SIDEBAR_COLLAPSED_BY_DEFAULT = true;
