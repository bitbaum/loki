/**
 * A site's own domain — the pure half. No I/O, so the rules are testable.
 *
 * Every site starts on <slug>.<base> (site-cd.ts). When its owner buys a
 * domain, the domain becomes the site's address and the free one forwards to
 * it with a 308. The box side is scripts/hetzner/attach-domain.sh, and it is
 * the authority: it re-checks DNS and refuses on its own. This module exists
 * so the owner sees the same answer BEFORE anything is sent there — which
 * records to set, and whether they are set yet.
 *
 * The two must agree on what an apex domain is and which records it needs;
 * scripts/test/site-domain.ts pins that against the script's own text.
 */
import { sitesBaseDomain } from "@/lib/site-cd";

/** Matches scripts/hetzner/_box-env.sh HETZNER_IP — where every site is served. */
export function sitesBoxIp(): string {
  return (process.env.LOKI_SITES_IP ?? "167.233.22.31").trim() || "167.233.22.31";
}

/** Same grammar as attach-domain.sh: labels of a-z0-9 and inner hyphens, a TLD. */
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export type OwnDomainParse = { ok: true; domain: string } | { ok: false; error: string };

/**
 * What the owner typed → the host to serve. Accepts what people paste: a URL,
 * capitals, a trailing dot or slash. Internationalised names become their
 * punycode form, which is what DNS and Caddy use.
 */
export function normalizeOwnDomain(
  input: string,
  base: string = sitesBaseDomain(),
): OwnDomainParse {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Type the domain you bought, e.g. evig.ch." };
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return { ok: false, error: `“${raw}” is not a domain name.` };
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(host)) {
    return { ok: false, error: `“${raw}” is not a domain name. It looks like evig.ch.` };
  }
  if (host === base || host.endsWith(`.${base}`)) {
    return {
      ok: false,
      error: `${host} is the free address this site already has. Type the domain you bought.`,
    };
  }
  return { ok: true, domain: host };
}

/**
 * evig.ch is an apex; shop.evig.ch is not. Two labels, the same rule the
 * script uses. Wrong for second-level public suffixes (example.co.uk), where
 * it asks for a CNAME at the apex; the registrar refuses that, and the A
 * record answer is in the same panel.
 */
export function isApexDomain(domain: string): boolean {
  return domain.split(".").length === 2;
}

export type DnsRecord = { type: "A" | "CNAME"; name: string; value: string };

/** The records to set at the registrar, exactly as attach-domain.sh prints them. */
export function dnsRecordsFor(
  domain: string,
  slug: string,
  base: string = sitesBaseDomain(),
  ip: string = sitesBoxIp(),
): DnsRecord[] {
  if (!isApexDomain(domain)) return [{ type: "CNAME", name: domain, value: `${slug}.${base}` }];
  return [
    { type: "A", name: domain, value: ip },
    { type: "CNAME", name: `www.${domain}`, value: `${slug}.${base}` },
  ];
}

/** The one command that does it on the box, for an operator to run by hand. */
export function attachDomainCommand(slug: string, domain: string | null): string {
  return domain
    ? `bash scripts/hetzner/attach-domain.sh ${slug} ${domain}`
    : `bash scripts/hetzner/attach-domain.sh ${slug} --detach`;
}

export type DnsAnswer = { a: string[]; aaaa: string[] };

export type DnsVerdict =
  | { ready: true }
  | { ready: false; reason: "no-record" | "elsewhere" | "ipv6-elsewhere"; detail: string };

/** Does this answer point at the box? Same test as the script's points_here. */
export function dnsVerdict(
  domain: string,
  answer: DnsAnswer,
  ip: string = sitesBoxIp(),
  ipv6: string | null = process.env.LOKI_SITES_IPV6?.trim() || null,
): DnsVerdict {
  if (answer.a.length === 0) {
    return {
      ready: false,
      reason: "no-record",
      detail: `${domain} has no address yet. Set the records below; changes can take up to an hour to arrive.`,
    };
  }
  const stray = answer.a.filter((a) => a !== ip);
  if (stray.length) {
    return {
      ready: false,
      reason: "elsewhere",
      detail: `${domain} points at ${stray.join(", ")}, not at this site's server (${ip}). Replace that record.`,
    };
  }
  const stray6 = answer.aaaa.filter((a) => !a.startsWith("::ffff:") && a !== ipv6);
  if (stray6.length) {
    return {
      ready: false,
      reason: "ipv6-elsewhere",
      detail: `${domain} also has an IPv6 (AAAA) record pointing elsewhere (${stray6.join(", ")}). Remove it — the certificate check would go there.`,
    };
  }
  return { ready: true };
}

/** The free address's host, or null when the live URL is already an own domain. */
export function freeHostOf(
  liveUrl: string | null | undefined,
  base: string = sitesBaseDomain(),
): string | null {
  const host = hostOf(liveUrl);
  return host && (host === base || host.endsWith(`.${base}`)) ? host : null;
}

/** The own domain a live URL is on, or null when it is still the free address. */
export function ownDomainOf(
  liveUrl: string | null | undefined,
  base: string = sitesBaseDomain(),
): string | null {
  const host = hostOf(liveUrl);
  return host && !freeHostOf(liveUrl, base) ? host : null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The two addresses a hosted site can have, from the register: the own domain
 * it is on (if any) and the free host it falls back to (if any). Null when the
 * live URL is not a site this studio serves — an owner can type any live URL,
 * and a Vercel deployment has no domain for us to move.
 */
export function siteAddresses(
  liveUrl: string | null | undefined,
  apps: { domains: string[] }[],
  base: string = sitesBaseDomain(),
): { ownDomain: string | null; freeHost: string | null } | null {
  const free = freeHostOf(liveUrl, base);
  const host = free ?? ownDomainOf(liveUrl, base);
  const row = host ? apps.find((app) => app.domains.includes(host)) : undefined;
  if (!host || !row) return null;
  if (free) return { ownDomain: null, freeHost: free };
  const freeHost = row.domains.find((d) => d === base || d.endsWith(`.${base}`)) ?? null;
  return { ownDomain: host, freeHost };
}
