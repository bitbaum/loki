import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { locales } from "./routing";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

/** `{name}` and `{count, plural, …}` arguments a message takes. */
function args(message: string): string[] {
  // A plural branch body (`one {# page}`, `=0 {Done}`) is text, not an argument.
  return [...message.matchAll(/(?<!(?:=\d+|zero|one|two|few|many|other)\s*)\{\s*(\w+)\s*[,}]/g)]
    .map((m) => m[1] ?? "")
    .toSorted();
}

const source = leaves(en);
const translations = { de: leaves(de), fr: leaves(fr) };

it("every routed language has a message file, and no file is unrouted", () => {
  expect(["en", ...Object.keys(translations)].toSorted()).toEqual([...locales].toSorted());
});

describe.each(Object.entries(translations))("messages/%s.json", (_locale, translated) => {
  it("has exactly the keys English has", () => {
    expect([...translated.keys()].toSorted()).toEqual([...source.keys()].toSorted());
  });

  it("leaves no message empty", () => {
    const empty = [...translated].filter(([, value]) => !value.trim()).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("takes the same arguments as English in every message", () => {
    const mismatched = [...source]
      .filter(([key, value]) => String(args(value)) !== String(args(translated.get(key) ?? "")))
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });
});

describe("messages/en.json", () => {
  it("leaves no message empty", () => {
    expect([...source].filter(([, value]) => !value.trim()).map(([key]) => key)).toEqual([]);
  });
});

describe("Swiss German", () => {
  it("is spelled with ss, never ß", () => {
    expect([...translations.de].filter(([, value]) => value.includes("ß")).map(([k]) => k)).toEqual(
      [],
    );
  });
});
