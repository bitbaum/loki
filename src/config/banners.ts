/**
 * Routes where the viewport IS the working surface, so an optional reminder
 * banner may not take a slice of it. On a phone these pages already give
 * most of the screen to fixed chrome; a banner saying something not required
 * can wait for any other page. SSOT for every shell banner.
 */
export const BANNER_FREE_ROUTES = ["/terminal", "/control"] as const;

export function isBannerFreeRoute(pathname: string | null): boolean {
  return (
    !!pathname && BANNER_FREE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  );
}
