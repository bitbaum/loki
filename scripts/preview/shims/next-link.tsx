import * as React from "react";
// next/link stand-in for the static preview: a plain anchor.
export default function Link({
  href,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
