/**
 * The prompt library is findable (operator, 2026-10-15: "it's not that easy to
 * find them. It's not that easy to search for them").
 *  - a prompt is found by the words INSIDE it, not only by its name;
 *  - those matches never outrank a name typed with one slip;
 *  - your own saved prompts are in the same search, and lead among equals.
 */
import { PROMPT_TEMPLATES } from "@/config/prompt-library";
import {
  PROMPT_ENTRY_SEARCH_SPEC,
  PROMPT_SEARCH_SPEC,
  savedPromptAsTemplate,
  searchPrompts,
  type PromptEntry,
} from "@/lib/prompt-search";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const bodyOf = (t: { template: string }) => t.template;

// A word that is in some prompt's text but in no prompt's name, tags or
// description — so only the text can find it.
const labels = PROMPT_TEMPLATES.map((t) =>
  [t.name, t.description, ...(t.tags ?? [])].join(" ").toLowerCase(),
).join(" ");
const textOnly = PROMPT_TEMPLATES.flatMap((t) =>
  (t.template.toLowerCase().match(/\b[a-z]{8,}\b/g) ?? [])
    .filter((w) => !labels.includes(w))
    .map((word) => ({ word, id: t.id })),
)[0];
check("the library has a word only its text holds", Boolean(textOnly));
const hits = searchPrompts(PROMPT_TEMPLATES, PROMPT_SEARCH_SPEC, bodyOf, textOnly!.word);
check(
  `"${textOnly!.word}" finds a prompt that only says it in its text`,
  hits.some((h) => h.item.id === textOnly!.id),
);
const first = PROMPT_TEMPLATES[0]!;
const typo = first.name.length > 5 ? first.name.slice(0, 2) + first.name.slice(3) : first.name;
check(
  "a name with one slip still comes first",
  searchPrompts(PROMPT_TEMPLATES, PROMPT_SEARCH_SPEC, bodyOf, typo)[0]?.item.id === first.id,
);
check(
  "no prompt is listed twice",
  (() => {
    const ids = searchPrompts(PROMPT_TEMPLATES, PROMPT_SEARCH_SPEC, bodyOf, "test").map(
      (h) => h.item.id,
    );
    return ids.length === new Set(ids).size;
  })(),
);

const mine = savedPromptAsTemplate({
  id: "u1",
  name: "Ship the landing page",
  description: "",
  body: "Finish the hero and deploy",
  scope: "project",
  tags: [],
  runCount: 3,
});
const entries: PromptEntry[] = [
  { template: mine, own: true, uses: 3 },
  ...PROMPT_TEMPLATES.map((template) => ({ template, own: false, uses: 0 })),
];
check(
  "your own prompt is found by its name",
  searchPrompts(entries, PROMPT_ENTRY_SEARCH_SPEC, (e) => e.template.template, "landing")[0]?.item
    .own === true,
);
check(
  "…and by the words in it",
  searchPrompts(entries, PROMPT_ENTRY_SEARCH_SPEC, (e) => e.template.template, "hero").some(
    (h) => h.item.own,
  ),
);

console.log(`\n${passed} passed`);
