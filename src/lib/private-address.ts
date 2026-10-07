/**
 * isPrivateAddress — "is this IP something a server-side fetch must never
 * touch": loopback, RFC 1918, link-local / cloud metadata, CGNAT, ULA,
 * multicast, reserved, and v4-mapped v6 forms of all of them.
 *
 * Ported verbatim from bitbaum/orangecat src/lib/security/private-address.ts,
 * where it is the one implementation behind the Cat's website reader. Loki's
 * first server-side fetch of a stranger-supplied address is the site
 * consultation (lib/site-consult/fetch-page.ts). Keep the two in step: a range
 * added to one and not the other is a silent SSRF hole.
 *
 * Fail-closed: any string that is not a well-formed address counts as private.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase();

  // IPv6 (including v4-mapped ::ffff:a.b.c.d)
  if (addr.includes(":")) {
    const unbracketed = addr.replace(/^\[|\]$/g, "");
    const mapped = unbracketed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isPrivateAddress(mapped[1]);
    }
    if (unbracketed === "::" || unbracketed === "::1") {
      return true; // unspecified / loopback
    }
    if (/^fe[89ab]/.test(unbracketed)) {
      return true; // link-local fe80::/10
    }
    if (/^f[cd]/.test(unbracketed)) {
      return true; // unique-local fc00::/7
    }
    if (/^fe[cdef]/.test(unbracketed)) {
      return true; // deprecated site-local fec0::/10
    }
    if (/^ff/.test(unbracketed)) {
      return true; // multicast ff00::/8
    }
    return false;
  }

  // IPv4
  const octets = addr.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return true; // not a well-formed IPv4 — refuse rather than guess
  }
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (cloud metadata!)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 0) || // 192.0.0.0/24 + 192.0.2.0/24 special/doc
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 // multicast 224/4 + reserved 240/4 + broadcast
  );
}
