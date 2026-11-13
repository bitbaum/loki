/**
 * A bot's own browser (src/lib/bot-browser*.ts, bot-shots.ts): Cat Bot's
 * computer use.
 *
 * Pinned: a bot never types a password, a sign-in code or a card; only web
 * pages open; the box holds a few browsers and a session somebody is in the
 * middle of is never closed for another; a picture is served by a name
 * nobody can guess, for a week; and the door is the signed rail.
 *
 * Run: npx tsx scripts/test/bot-browser.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOT_BROWSER_BUSY_MS,
  BOT_BROWSER_IDLE_MS,
  BOT_BROWSER_MAX_LIFE_MS,
  BOT_BROWSER_MAX_SESSIONS,
  BotBrowserAction,
  openableUrl,
  refusalForField,
  sessionToEvict,
  sessionsToClose,
} from "@/lib/bot-browser-rules";
import { SHOT_TTL_MS, isShotToken, shotUrl, shotsToDrop } from "@/lib/bot-shots";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
console.log("bot-browser:");

t("a bot never types a password or a sign-in code", () => {
  for (const f of [
    { type: "password", autocomplete: "", name: "" },
    { type: "text", autocomplete: "current-password", name: "" },
    { type: "text", autocomplete: "one-time-code", name: "" },
  ]) {
    assert.match(refusalForField(f) ?? "", /owner signs in themselves/);
  }
});
t("nor a card", () => {
  assert.match(
    refusalForField({ type: "text", autocomplete: "cc-number", name: "" }) ?? "",
    /owner pays themselves/,
  );
  assert.ok(refusalForField({ type: "tel", autocomplete: "", name: "cardNumber x" }));
});
t("an ordinary field is typed into", () => {
  assert.equal(refusalForField({ type: "email", autocomplete: "email", name: "email" }), null);
  assert.equal(refusalForField({ type: "search", autocomplete: "", name: "q" }), null);
  assert.equal(refusalForField(null), null);
});

t("only web pages open", () => {
  assert.equal(openableUrl("file:///etc/passwd").ok, false);
  assert.equal(openableUrl("javascript:alert(1)").ok, false);
  assert.equal(openableUrl("orangecat.ch").ok, false);
  const ok = openableUrl(" https://orangecat.ch/discover ");
  assert.ok(ok.ok && ok.url === "https://orangecat.ch/discover");
});

t("an action is one of the known steps, with nothing extra", () => {
  assert.ok(BotBrowserAction.safeParse({ do: "open", url: "https://a.test" }).success);
  assert.ok(BotBrowserAction.safeParse({ do: "click", n: 3 }).success);
  assert.ok(BotBrowserAction.safeParse({ do: "type", text: "hi", n: 2, submit: true }).success);
  assert.ok(BotBrowserAction.safeParse({ do: "press", key: "Enter" }).success);
  assert.equal(BotBrowserAction.safeParse({ do: "press", key: "F12" }).success, false);
  assert.equal(BotBrowserAction.safeParse({ do: "eval", code: "1" }).success, false);
  assert.equal(BotBrowserAction.safeParse({ do: "look", extra: 1 }).success, false);
});

const now = 10_000_000;
t("an idle session closes, and so does one open too long", () => {
  const closed = sessionsToClose(
    [
      { key: "idle", lastUsedAt: now - BOT_BROWSER_IDLE_MS, openedAt: now - BOT_BROWSER_IDLE_MS },
      { key: "old", lastUsedAt: now - 1_000, openedAt: now - BOT_BROWSER_MAX_LIFE_MS },
      { key: "live", lastUsedAt: now - 1_000, openedAt: now - 60_000 },
    ],
    now,
  );
  assert.deepEqual(closed.sort(), ["idle", "old"]);
});
t("a full box gives up its least recently used session, never one in use", () => {
  const full = Array.from({ length: BOT_BROWSER_MAX_SESSIONS }, (_, i) => ({
    key: `s${i}`,
    lastUsedAt: now - BOT_BROWSER_BUSY_MS - i * 1_000,
    openedAt: now - 100_000,
  }));
  assert.equal(sessionToEvict(full, now), `s${BOT_BROWSER_MAX_SESSIONS - 1}`);
  const busy = full.map((s) => ({ ...s, lastUsedAt: now - 1_000 }));
  assert.equal(sessionToEvict(busy, now), null);
  assert.equal(sessionToEvict(full.slice(1), now), null, "room left: nobody gives way");
});

t("a picture's name is 32 hex characters, and nothing else reads a file", () => {
  assert.ok(isShotToken("0123456789abcdef0123456789abcdef"));
  for (const bad of ["../../etc/passwd", "0123", "0123456789ABCDEF0123456789abcdef", ""]) {
    assert.equal(isShotToken(bad), false, bad);
  }
  assert.equal(
    shotUrl("https://loki.orangecat.ch/", "0123456789abcdef0123456789abcdef"),
    "https://loki.orangecat.ch/api/orangecat/shot/0123456789abcdef0123456789abcdef",
  );
});
t("pictures go after a week, and the oldest go when there are too many", () => {
  const files = [
    { name: "old.jpg", mtimeMs: now - SHOT_TTL_MS },
    { name: "a.jpg", mtimeMs: now - 3_000 },
    { name: "b.jpg", mtimeMs: now - 2_000 },
    { name: "c.jpg", mtimeMs: now - 1_000 },
  ];
  assert.deepEqual(shotsToDrop(files, now), ["old.jpg"]);
  assert.deepEqual(shotsToDrop(files, now, 2).sort(), ["a.jpg", "old.jpg"]);
});

const route = readFileSync("src/app/api/orangecat/browser/route.ts", "utf8");
t("the door is the signed rail, fresh, for a linked account, one browser per bot", () => {
  assert.match(route, /readSignedOrangeCatBody\(/);
  assert.match(route, /isFreshIssuedAt\(/);
  assert.ok(route.indexOf("getUserByOrangeCatActorId(") < route.indexOf("botBrowserStep("));
  assert.match(route, /botBrowserStep\(user\.id, data\.botId,/);
});
const lib = readFileSync("src/lib/bot-browser.ts", "utf8");
t("the whole context is kept out of the private network, and typing asks the rules first", () => {
  assert.match(lib, /context\.route\("\*\*\/\*", privateNetworkGuard\(\)\)/);
  assert.ok(lib.indexOf("refusalForField(") < lib.indexOf(".fill(action.text)"));
  assert.doesNotMatch(
    lib,
    /page\.evaluate\(\s*\(/,
    "page functions are strings (bundlers rename inner functions)",
  );
});

console.log(`  ${passed} passed`);
