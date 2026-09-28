// next/navigation stand-in for the static preview.
export function useSearchParams() {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}
export function useRouter() {
  return {
    push: (href: string) => console.log("[router.push]", href),
    replace: (href: string) => console.log("[router.replace]", href),
    refresh: () => {},
    back: () => {},
  };
}
export function usePathname() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}
export function redirect(href: string) {
  console.log("[redirect]", href);
}
