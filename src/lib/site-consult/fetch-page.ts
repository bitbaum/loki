import { CONSULT } from "@/config/site-consult";
import { isPrivateAddress } from "@/lib/private-address";
import { normalizeWebsite } from "@/lib/website-brief";

/**
 * Fetch ONE public web page for the site consultation, with the SSRF guard
 * rails a stranger-supplied address demands:
 *
 * - the address goes through normalizeWebsite (public domain, default port,
 *   no credentials, no IP literal, no .local/.internal)
 * - DNS is resolved and EVERY answer must be public, on every redirect hop
 * - redirects are followed by hand (CONSULT.maxRedirects) and re-validated
 * - a hard timeout and byte cap; HTML only
 *
 * Known TOCTOU caveat, shared with OrangeCat's website reader: after checking
 * the DNS answer we fetch by hostname, so a hostile authoritative server could
 * re-answer privately between lookup and connect. Pinning the connection to
 * the checked address breaks TLS SNI without a custom undici dialer.
 *
 * Never throws; a failure is a sentence a person can act on.
 */

export type PageFetch =
  | {
      ok: true;
      requestedUrl: string;
      finalUrl: string;
      html: string;
      /** Response headers the rules read (lower-cased names). */
      headers: { robots: string };
      /** From the first request to the last byte, redirects included. */
      ms: number;
      bytes: number;
      truncated: boolean;
    }
  | { ok: false; requestedUrl: string | null; reason: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type LookupLike = (host: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupLike = async (host) => {
  const dns = await import("node:dns/promises");
  return dns.lookup(host, { all: true, verbatim: true });
};

async function publicHost(host: string, lookup: LookupLike): Promise<string | null> {
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(host);
  } catch {
    return `${host} does not exist — check the spelling.`;
  }
  if (!answers.length) return `${host} does not exist — check the spelling.`;
  if (answers.some((a) => isPrivateAddress(a.address)))
    return "That address points into a private network, so Loki will not open it.";
  return null;
}

/** A redirect target gets the same scrutiny as the address someone typed. */
function nextHop(location: string, from: URL): URL | null {
  try {
    const url = new URL(location, from);
    return normalizeWebsite(url.href) ? url : null;
  } catch {
    return null;
  }
}

function charsetOf(contentType: string): string {
  const match = /charset=["']?([\w-]+)/i.exec(contentType);
  return match ? match[1].toLowerCase() : "utf-8";
}

async function readCapped(res: Response): Promise<{ buf: Uint8Array; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { buf: buf.slice(0, CONSULT.maxBytes), truncated: buf.byteLength > CONSULT.maxBytes };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= CONSULT.maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    buf.set(chunk, at);
    at += chunk.byteLength;
  }
  return { buf: buf.slice(0, CONSULT.maxBytes), truncated };
}

function decode(buf: Uint8Array, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function fetchFrom(start: URL, fetchFn: FetchLike, lookup: LookupLike): Promise<PageFetch> {
  const requestedUrl = start.href;
  const began = Date.now();
  const deadline = began + CONSULT.timeoutMs;
  let target = start;
  for (let hop = 0; hop <= CONSULT.maxRedirects; hop++) {
    const hostProblem = await publicHost(target.hostname, lookup);
    if (hostProblem) return { ok: false, requestedUrl, reason: hostProblem };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      const res = await fetchFn(target.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": CONSULT.userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "de-CH,de;q=0.9,en;q=0.8,fr;q=0.7",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        const next = location ? nextHop(location, target) : null;
        if (!next)
          return {
            ok: false,
            requestedUrl,
            reason: "The site sends visitors on to an address Loki cannot follow.",
          };
        if (hop === CONSULT.maxRedirects)
          return {
            ok: false,
            requestedUrl,
            reason: `The site forwards visitors more than ${CONSULT.maxRedirects} times before showing a page — that alone is worth fixing.`,
          };
        target = next;
        continue;
      }
      if (res.status === 401 || res.status === 403)
        return {
          ok: false,
          requestedUrl,
          reason:
            "The site refused to show this page to Loki (it may block automated visitors or need a login).",
        };
      if (!res.ok)
        return {
          ok: false,
          requestedUrl,
          reason: `The site answered with an error (HTTP ${res.status}) instead of a page.`,
        };
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType))
        return { ok: false, requestedUrl, reason: "That address is a file, not a web page." };
      const { buf, truncated } = await readCapped(res);
      return {
        ok: true,
        requestedUrl,
        finalUrl: target.href,
        html: decode(buf, contentType),
        headers: { robots: res.headers.get("x-robots-tag") ?? "" },
        ms: Date.now() - began,
        bytes: buf.byteLength,
        truncated,
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        requestedUrl,
        reason: aborted
          ? `The site took longer than ${CONSULT.timeoutMs / 1000} seconds to answer. Most visitors would have left by then.`
          : "The site could not be reached.",
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, requestedUrl, reason: "The site forwards visitors in a loop." };
}

/**
 * The page at `raw`. An address typed without a scheme is tried over https
 * first; if that fails outright, plain http once — a site that only answers
 * there is the single most important thing the consultation can tell its
 * owner, not a reason to give up.
 */
export async function fetchPage(
  raw: string,
  deps: { fetchFn?: FetchLike; lookup?: LookupLike } = {},
): Promise<PageFetch> {
  const fetchFn = deps.fetchFn ?? (fetch as FetchLike);
  const lookup = deps.lookup ?? defaultLookup;
  const normalized = normalizeWebsite(raw);
  if (!normalized)
    return {
      ok: false,
      requestedUrl: null,
      reason:
        "That doesn’t look like a public website address. Try something like your-company.ch.",
    };
  const start = new URL(normalized);
  const first = await fetchFrom(start, fetchFn, lookup);
  const typedScheme = /^https?:\/\//i.test(raw.trim());
  if (first.ok || typedScheme || start.protocol !== "https:") return first;
  const plain = new URL(start.href);
  plain.protocol = "http:";
  const second = await fetchFrom(plain, fetchFn, lookup);
  return second.ok ? second : first;
}
