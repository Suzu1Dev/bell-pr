import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { walkthroughPrompt } from "./walkthroughs.js";
import type { Locale } from "../../shared/i18n/locale.js";
import { outputLanguage, respondIn } from "../prompt-language.js";

/** Han characters and CJK punctuation; the Latin middle dot is not one. */
const cjk = /(?!\u00B7)[\p{Script_Extensions=Han}\u3000-\u303F\uFF00-\uFFEF]/u;

/**
 * The fixture holds each prompt as its lines. It was recorded in English
 * from the upstream wording (1fb6329) once the prompt took the run's
 * locale, so a failure means the text the walkthrough agent receives
 * changed.
 */
async function fixture() {
  const lines = JSON.parse(
    await readFile(
      path.join(import.meta.dirname, "fixtures", "walkthrough-prompts.json"),
      "utf8",
    ),
  ) as Record<string, string[]>;
  return Object.fromEntries(
    Object.entries(lines).map(([key, value]) => [key, value.join("\n")]),
  );
}

const patch = [
  "@@ -1,4 +1,4 @@",
  " export function count(items: number[]) {",
  "-  const total = items.length;",
  "+  const total = items.length + 0;",
  "   return total;",
  " }",
  "@@ -8,1 +8,4 @@",
  " ",
  "+export function empty() {",
  "+  return count([]);",
  "+}",
].join("\n");

const prompts = (locale: Locale) => ({
  walkthroughPrompt: walkthroughPrompt({
    locale,
    contributionContext: "Count items\nUser request:\nCount the items.",
    file: { path: "src/count.ts", patch },
  }),
});

test("the walkthrough prompt keeps its recorded wording", async () => {
  assert.deepEqual(prompts("en"), await fixture());
});

test("the walkthrough prompt answers in the run's locale and stays English text", () => {
  const english = prompts("en").walkthroughPrompt;
  const chinese = prompts("zh-TW").walkthroughPrompt;
  assert.doesNotMatch(english, cjk);
  assert.ok(english.includes(respondIn("en")));
  assert.equal(
    chinese,
    english
      .replace(respondIn("en"), respondIn("zh-TW"))
      .replaceAll(` in ${outputLanguage("en")}`, ` in ${outputLanguage("zh-TW")}`),
  );
  // The changed lines, not the context around them, locate the units.
  assert.match(english, /ranges of the current file: \[\{"startLine":2,"endLine":2\},\{"startLine":9,"endLine":11\}\]/);
});
