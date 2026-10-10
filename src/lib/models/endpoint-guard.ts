import { isPrivateAddress } from "@/lib/private-address";

/**
 * The gate a person's OWN endpoint passes before Loki's server will send their
 * key to it.
 *
 * ── The threat ───────────────────────────────────────────────────────────────
 * "Your own endpoint" means the server makes an outbound request to a URL a
 * stranger typed, with a bearer token attached. Without a gate that is a
 * server-side request forgery: a URL of `https://127.0.0.1:5432/...` or the
 * cloud metadata address would let any account make Loki's box talk to
 * services only the box can reach. ai-kit refuses base URLs for exactly this
 * reason. Loki wants the feature — it is the only way a laptop model becomes a
 * provider — so it pays for it with this file.
 *
 * ── Two checks, because one is not enough ────────────────────────────────────
 *   parseEndpoint   what the person typed: https only, no credentials in the
 *                   URL, no literal private address, no name that only means
 *                   something on a LAN, a port a tunnel actually serves.
 *   guardedFetch    what the connection actually goes to: the hostname is
 *                   resolved at CONNECT time and every answer must be public.
 *                   Checking only at save time leaves the classic rebinding
 *                   gap (a name that answers public once and private next),
 *                   which `site-consult/fetch-page.ts` documents as the gap it
 *                   could not close without a custom dialer. undici's Agent
 *                   takes one, so here it is closed. Redirects are refused
 *                   outright: a 3xx to an IP literal would skip the lookup,
 *                   and a chat completion never needs one.
 *
 * `isPrivateAddress` (lib/private-address.ts) is the one range table; this
 * file adds no second one.
 */
export type EndpointVerdict = { ok: true; baseUrl: string } | { ok: false; reason: string };

export type LookupLike = (host: string) => Promise<Array<{ address: string; family?: number }>>;

/** Ports a tunnel actually serves. 443 and anything a person may pick above the privileged range. */
function portAllowed(port: string): boolean {
  if (port === "") return true; // https default, 443
  const n = Number(port);
  return n === 443 || (Number.isInteger(n) && n >= 1024 && n <= 65535);
}

/** Names that only mean something on a LAN — never a public endpoint. */
const LOCAL_NAME = /^(localhost|.*\.(local|localhost|internal|lan|home|corp|intranet))$/i;
const TRAILING_API_PATH = /\/(chat\/completions|models|completions)\/?$/i;

export const ENDPOINT_MAX_LENGTH = 300;

/**
 * The URL a person typed → the base URL Loki will store, or the one sentence
 * saying why not. Pure: no network, no DNS — the resolved addresses are
 * checked where the connection is made.
 */
export function parseEndpoint(input: string): EndpointVerdict {
  const text = input.trim();
  if (!text) return { ok: false, reason: "Paste the URL of your endpoint." };
  if (text.length > ENDPOINT_MAX_LENGTH) return { ok: false, reason: "That URL is too long." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "That is not a full URL — it should start with https://." };
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason: "Loki only talks to your endpoint over https — a tunnel gives you that for free.",
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Leave the username and password out of the URL." };
  }
  if (!portAllowed(url.port)) {
    return { ok: false, reason: "Use port 443 or a port above 1024." };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (LOCAL_NAME.test(host)) {
    return {
      ok: false,
      reason:
        "That name only works on your own network. Loki's server cannot reach it — put the endpoint behind a tunnel first.",
    };
  }
  if (looksLikeIp(host) && isPrivateAddress(host)) {
    return {
      ok: false,
      reason:
        "That address is private to your network, so Loki's server cannot reach it — put the endpoint behind a tunnel first.",
    };
  }
  if (url.search || url.hash) {
    return { ok: false, reason: "Drop everything after the path — no ?query or #fragment." };
  }
  const path = url.pathname.replace(TRAILING_API_PATH, "").replace(/\/+$/, "");
  return { ok: true, baseUrl: `${url.protocol}//${url.host}${path}` };
}

function looksLikeIp(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
}

/** What the connect-time gate says about one name's answers. Pure. */
export function judgeAnswers(
  host: string,
  answers: ReadonlyArray<{ address: string }>,
): string | null {
  if (answers.length === 0) return `${host} does not resolve to any address.`;
  if (answers.some((a) => isPrivateAddress(a.address))) {
    return `${host} points into a private network, so Loki will not connect to it.`;
  }
  return null;
}

const defaultLookup: LookupLike = async (host) => {
  const dns = await import("node:dns/promises");
  return dns.lookup(host, { all: true, verbatim: true });
};

/** Resolve a name and refuse it unless every address is public. */
export async function assertPublicHost(host: string, lookup: LookupLike = defaultLookup) {
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(host);
  } catch {
    throw new Error(`${host} does not resolve — check the spelling.`);
  }
  const why = judgeAnswers(host, answers);
  if (why) throw new Error(why);
  return answers;
}

type Dispatcher = import("undici").Dispatcher;
let agent: Dispatcher | null = null;

/**
 * A fetch whose every connection is gated: the dialer resolves the name
 * itself and refuses a private answer at the moment it would connect. Built
 * once; undici keeps the sockets.
 */
async function guardedDispatcher(): Promise<Dispatcher> {
  if (agent) return agent;
  const { Agent } = await import("undici");
  const dns = await import("node:dns");
  agent = new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, answers) => {
          if (err) return callback(err, [] as never);
          const list = Array.isArray(answers) ? answers : [answers];
          const why = judgeAnswers(hostname, list);
          if (why) return callback(new Error(why), [] as never);
          callback(null, list as never);
        });
      },
    },
  });
  return agent;
}

/**
 * fetch() for a person's own endpoint. The URL is re-parsed here so a row
 * written under an older rule is still held to the current one, and the
 * connection is made through the gated dialer. Redirects are errors.
 */
export async function guardedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const verdict = parseEndpoint(input.replace(TRAILING_API_PATH, ""));
  if (!verdict.ok) throw new Error(verdict.reason);
  const { fetch: undiciFetch } = await import("undici");
  const dispatcher = await guardedDispatcher();
  const res = await undiciFetch(input, {
    ...(init as import("undici").RequestInit),
    redirect: "error",
    dispatcher,
  });
  // undici's Response and the global one are the same shape for everything
  // Loki reads (status, headers, body stream, text/json).
  return res as unknown as Response;
}
