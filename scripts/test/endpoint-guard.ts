/**
 * The gate a person's own endpoint passes before Loki's server sends their
 * key to it — the whole reason "your own endpoint" can exist at all.
 *
 * Pins: what the person types is refused for every shape that would let the
 * server reach something only the server can reach (plain http, credentials
 * in the URL, a private or loopback address, a LAN-only name, a privileged
 * port); a public https URL is accepted and normalised; and the connect-time
 * judge refuses a name whose answers include ONE private address, which is
 * the rebinding case the save-time check cannot see.
 *
 * Run: npx tsx scripts/test/endpoint-guard.ts
 */
import assert from "node:assert/strict";
import { assertPublicHost, judgeAnswers, parseEndpoint } from "@/lib/models/endpoint-guard";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const refused = (url: string, why: RegExp) => {
  const v = parseEndpoint(url);
  assert.equal(v.ok, false, `${url} should be refused`);
  if (!v.ok) assert.match(v.reason, why, url);
};

console.log("endpoint-guard:");

async function main() {
  await check("plain http, credentials, and junk are refused with the reason", () => {
    refused("http://my-box.example.com/v1", /https/);
    refused("https://user:pw@my-box.example.com/v1", /username and password/);
    refused("my-box.example.com/v1", /full URL/);
    refused("", /Paste/);
    refused("https://" + "a".repeat(300) + ".com", /too long/);
    refused("https://my-box.example.com/v1?key=1", /query/);
  });

  await check("every private, loopback, link-local and metadata literal is refused", () => {
    for (const host of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.5",
      "192.168.1.20",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "[::1]",
      "[fd00::1]",
      "[fe80::1]",
      "[::ffff:10.0.0.1]",
    ]) {
      refused(`https://${host}:8443/v1`, /private|network/);
    }
  });

  await check("names that only mean something on a LAN are refused", () => {
    for (const host of ["localhost", "ollama.local", "box.internal", "nas.lan", "pc.home"]) {
      refused(`https://${host}/v1`, /own network/);
    }
  });

  await check("ports: 443 and anything above 1024 pass; a privileged port does not", () => {
    assert.equal(parseEndpoint("https://mac.tail1234.ts.net/v1").ok, true);
    assert.equal(parseEndpoint("https://mac.tail1234.ts.net:443/v1").ok, true);
    assert.equal(parseEndpoint("https://mac.tail1234.ts.net:8443/v1").ok, true);
    assert.equal(parseEndpoint("https://mac.tail1234.ts.net:10000/v1").ok, true);
    refused("https://mac.tail1234.ts.net:80/v1", /port/);
    refused("https://mac.tail1234.ts.net:22/v1", /port/);
  });

  await check("a public https URL is accepted and normalised to its base", () => {
    const v = parseEndpoint("  https://Mac.tail1234.ts.net/v1/chat/completions/  ");
    assert.deepEqual(v, { ok: true, baseUrl: "https://mac.tail1234.ts.net/v1" });
    assert.deepEqual(parseEndpoint("https://gw.example.com/openai/v1/models"), {
      ok: true,
      baseUrl: "https://gw.example.com/openai/v1",
    });
    assert.deepEqual(parseEndpoint("https://gw.example.com"), {
      ok: true,
      baseUrl: "https://gw.example.com",
    });
    assert.equal(parseEndpoint("https://8.8.8.8:8443/v1").ok, true, "a public literal is fine");
  });

  await check("the connect-time judge refuses ONE private answer among public ones", () => {
    assert.equal(judgeAnswers("x", [{ address: "8.8.8.8" }]), null);
    assert.match(judgeAnswers("x", [{ address: "8.8.8.8" }, { address: "10.0.0.5" }])!, /private/);
    assert.match(judgeAnswers("x", [{ address: "::1" }])!, /private/);
    assert.match(judgeAnswers("x", [])!, /does not resolve/);
  });

  await check("assertPublicHost uses the lookup it is given and never guesses", async () => {
    const answers = await assertPublicHost("mac.tail1234.ts.net", async () => [
      { address: "93.184.216.34" },
    ]);
    assert.equal(answers.length, 1);
    await assert.rejects(
      assertPublicHost("rebind.example.com", async () => [
        { address: "93.184.216.34" },
        { address: "127.0.0.1" },
      ]),
      /private/,
    );
    await assert.rejects(
      assertPublicHost("nope.example", async () => {
        throw new Error("ENOTFOUND");
      }),
      /does not resolve/,
    );
  });

  console.log(`\nendpoint-guard: ${passed} passed`);
}

void main();
